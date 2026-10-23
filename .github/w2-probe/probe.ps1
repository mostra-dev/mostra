# A disposable probe of the Windows facts WP-W2's design relies on (removed before the package
# merges): Windows Firewall and loopback binds, and Task Scheduler as a per-user login service.
param([string]$Which = "all", [string]$Node = "node")
$ErrorActionPreference = "Continue"

function Out-Fact($probe, $facts) { "$probe :: " + ($facts | ConvertTo-Json -Depth 6 -Compress) }

function Probe-Firewall {
  Out-Fact "firewall-before" (Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, NotifyOnListen, AllowInboundRules)
  Out-Fact "node-rules" (Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like "*node*" } | Select-Object Program)
  Set-NetFirewallProfile -All -Enabled True -DefaultInboundAction Block -NotifyOnListen True
  auditpol /set /subcategory:"Filtering Platform Connection" /success:enable /failure:enable | Out-Null
  auditpol /set /subcategory:"Filtering Platform Policy Change" /success:enable /failure:enable | Out-Null
  $node = (Get-Command $Node).Source
  foreach ($bind in @("127.0.0.1", "0.0.0.0")) {
    $start = Get-Date
    $p = Start-Process -FilePath $node -ArgumentList @("-e", "require('net').createServer().listen(0,'$bind',function(){console.log(this.address().port)});setTimeout(()=>process.exit(0),6000)") -PassThru -NoNewWindow
    $p.WaitForExit()
    Start-Sleep -Seconds 2
    $events = Get-WinEvent -FilterHashtable @{ LogName = "Security"; Id = 5031, 5154, 5155, 5156, 5157, 5158; StartTime = $start } -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match "node" } |
      ForEach-Object { @{ id = $_.Id; text = (($_.Message -split "`n" | Select-Object -First 12) -join " | ") } }
    Out-Fact "firewall-$bind" @{ pid = $p.Id; events = @($events) }
  }
  Out-Fact "node-rules-after" (Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like "*node*" } | Select-Object Program)
}

function Task-Xml($user, $logonType, $action, $arguments) {
  @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Mostra probe</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$user</UserId><LogonType>$logonType</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>$action</Command><Arguments>$arguments</Arguments></Exec></Actions>
</Task>
"@
}

function Probe-Tasks {
  $dir = "C:\mostra-probe"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  icacls $dir /grant "Everyone:(OI)(CI)F" | Out-Null
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  Out-Fact "whoami" @{ me = $me; admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
  # 1. A task that fails: does RestartOnFailure restart it?
  $xml = Task-Xml $me "InteractiveToken" "cmd.exe" "/c echo run %TIME% &gt;&gt; $dir\runs.txt &amp; exit /b 1"
  $file = "$dir\fail.xml"
  [System.IO.File]::WriteAllText($file, $xml, [System.Text.Encoding]::Unicode)
  $created = schtasks /Create /XML $file /TN "mostra-probe-fail" /F 2>&1
  Out-Fact "task-create-admin" @{ output = "$created"; code = $LASTEXITCODE }
  $run = schtasks /Run /TN "mostra-probe-fail" 2>&1
  Out-Fact "task-run" @{ output = "$run"; code = $LASTEXITCODE }
  Start-Sleep -Seconds 200
  $runs = if (Test-Path "$dir\runs.txt") { Get-Content "$dir\runs.txt" } else { @() }
  $info = Get-ScheduledTaskInfo -TaskName "mostra-probe-fail" | Select-Object LastRunTime, LastTaskResult, NumberOfMissedRuns
  Out-Fact "task-restart-on-failure" @{ runs = @($runs); info = $info }
  $query = schtasks /Query /TN "mostra-probe-fail" /XML 2>&1
  Out-Fact "task-query-xml" @{ text = ("$query").Substring(0, [Math]::Min(1500, ("$query").Length)) }
  schtasks /Delete /TN "mostra-probe-fail" /F | Out-Null
  Out-Fact "task-deleted" @{ exists = [bool](Get-ScheduledTask -TaskName "mostra-probe-fail" -ErrorAction SilentlyContinue) }

  # 2. The same as an ordinary user, at the root folder, InteractiveToken and S4U.
  if ($env:MOSTRA_TEST_OTHER_USER) {
    $other = "$env:COMPUTERNAME\$env:MOSTRA_TEST_OTHER_USER"
    $cred = New-Object System.Management.Automation.PSCredential($other, (ConvertTo-SecureString $env:MOSTRA_TEST_OTHER_PASSWORD -AsPlainText -Force))
    foreach ($type in @("InteractiveToken", "S4U")) {
      $xml = Task-Xml $other $type "cmd.exe" "/c echo other-$type %USERNAME% &gt;&gt; $dir\other.txt"
      $file = "$dir\other-$type.xml"
      [System.IO.File]::WriteAllText($file, $xml, [System.Text.Encoding]::Unicode)
      $outFile = "$dir\other-$type.out"
      $p = Start-Process -FilePath "schtasks.exe" -ArgumentList @("/Create", "/XML", $file, "/TN", "mostra-probe-other-$type", "/F") -Credential $cred -LoadUserProfile -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError "$outFile.err" -WorkingDirectory $dir
      $text = (Get-Content $outFile -ErrorAction SilentlyContinue) + (Get-Content "$outFile.err" -ErrorAction SilentlyContinue)
      Out-Fact "task-create-other-$type" @{ code = $p.ExitCode; output = "$text" }
      $p = Start-Process -FilePath "schtasks.exe" -ArgumentList @("/Run", "/TN", "mostra-probe-other-$type") -Credential $cred -LoadUserProfile -Wait -PassThru -RedirectStandardOutput "$outFile.run" -WorkingDirectory $dir
      Out-Fact "task-run-other-$type" @{ code = $p.ExitCode; output = "$(Get-Content "$outFile.run" -ErrorAction SilentlyContinue)" }
    }
    Start-Sleep -Seconds 10
    Out-Fact "task-other-ran" @{ lines = @(Get-Content "$dir\other.txt" -ErrorAction SilentlyContinue) }
    Out-Fact "task-other-list" (Get-ScheduledTask -TaskName "mostra-probe-other-*" -ErrorAction SilentlyContinue | Select-Object TaskName, TaskPath, State)
  }
}

if ($Which -eq "all" -or $Which -eq "firewall") { Probe-Firewall }
if ($Which -eq "all" -or $Which -eq "tasks") { Probe-Tasks }
