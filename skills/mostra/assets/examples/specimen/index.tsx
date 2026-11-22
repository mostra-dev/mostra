import { Figure, Figures, Page, Section } from "@mostra/kit/layout";
import { Choice, Question, Questionnaire, Scale, TextAnswer } from "@mostra/kit/questionnaire";
import { defineArtifact } from "@mostra/react";
import { BellIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Every part of the kit with nothing installed, in the theme its stack names: try another with
// `mostra verify <dir> --theme arcata`, or write `kit: { theme: "arcata" }`.
export const artifact = defineArtifact({
  title: "The kit's parts",
  description: "Every part of the kit, in the theme this page is built in.",
  submission: { policy: "none" },
  kit: { theme: "studio" },
  // A gallery of parts that do nothing on purpose: no smoke test to observe that.
  verify: { smoke: false },
});

const offices = [
  { value: "lisbon", label: "Lisbon" },
  { value: "berlin", label: "Berlin" },
  { value: "remote", label: "Remote" },
];

const deploys = [
  { service: "checkout-api", version: "2.41.0", status: "Live", duration: "4m 12s" },
  { service: "payments-worker", version: "1.18.2", status: "Rolled back", duration: "2m 05s" },
  { service: "search", version: "0.9.14", status: "Deploying", duration: "–" },
];

export default function Specimen() {
  return (
    <Page width="wide" title={artifact.title} description={artifact.description}>
      <Figures>
        <Figure label="Signups" value="642" change="+5.1% vs last week" tone="good" />
        <Figure label="Activation" value="38.4%" change="+1.2 points" tone="good" />
        <Figure label="Checkout errors" value="1.9%" change="+0.7 points" tone="bad" />
        <Figure label="Open tickets" value="14" change="as many as last week" />
      </Figures>

      <Section title="Actions">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Send my answers</Button>
          <Button variant="secondary">Save a copy</Button>
          <Button variant="outline">Preview</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Delete 3 drafts</Button>
          <Button variant="link">Read the plan</Button>
          <Button size="icon" variant="outline" aria-label="Notifications">
            <BellIcon />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            Add a priority
          </Button>
          <Button size="lg">Approve the plan</Button>
          <Button disabled>Sent</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>New</Badge>
          <Badge variant="secondary">Draft</Badge>
          <Badge variant="accent">In review</Badge>
          <Badge variant="success">Live</Badge>
          <Badge variant="warning">Waiting</Badge>
          <Badge variant="destructive">Failed</Badge>
          <Badge variant="outline">Archived</Badge>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" defaultValue="ada@example.com" />
          </div>
          <div className="grid gap-2">
            <Label id="office">Office</Label>
            <Select items={offices} defaultValue="lisbon">
              <SelectTrigger className="w-full" aria-labelledby="office">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {offices.map((office) => (
                  <SelectItem key={office.value} value={office.value}>
                    {office.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="notes">Notes for the team</Label>
            <Textarea id="notes" placeholder="What should they know before Monday…" />
          </div>
          <RadioGroup defaultValue="weekly" className="grid gap-3">
            {["Daily", "Weekly", "Never"].map((label) => (
              <Label key={label} className="flex items-center gap-3 font-normal">
                <RadioGroupItem value={label.toLowerCase()} />
                {label}
              </Label>
            ))}
          </RadioGroup>
          <div className="grid content-start gap-4">
            <Label className="flex items-center gap-3 font-normal">
              <Checkbox defaultChecked />
              Tell me when someone answers
            </Label>
            <Label className="flex items-center gap-3 font-normal">
              <Switch defaultChecked />
              Send a digest on Fridays
            </Label>
            <Label className="grid gap-3 font-normal">
              How sure are you?
              <Slider defaultValue={[60]} max={100} />
            </Label>
          </div>
        </div>
      </Section>

      <Section title="Surfaces">
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Hiring plan</CardTitle>
              <CardDescription>Four engineers in Q1, two pods of two.</CardDescription>
              <CardAction>
                <Badge variant="accent">In review</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Progress value={60} aria-label="Answered" />
              <p className="text-sm text-muted-foreground">3 of 5 people answered</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Answer</Button>
              <Button size="sm" variant="ghost">
                Later
              </Button>
            </CardFooter>
          </Card>
          <div className="flex flex-col gap-4">
            <Alert>
              <BellIcon />
              <AlertTitle>Checkout errors are up</AlertTitle>
              <AlertDescription>1.9% this week, against 1.2% last week.</AlertDescription>
            </Alert>
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>AL</AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: "outline", className: "w-fit" })}
              >
                Actions
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog>
              <DialogTrigger
                className={buttonVariants({ variant: "destructive", className: "w-fit" })}
              >
                Delete the drafts
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete the three draft replies?</DialogTitle>
                  <DialogDescription>
                    They go now, and nobody else has seen them. This can't be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose className={buttonVariants({ variant: "ghost" })}>
                    Keep them
                  </DialogClose>
                  <DialogClose className={buttonVariants({ variant: "destructive" })}>
                    Delete 3 drafts
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </Section>

      <Section title="Navigation and data">
        <Tabs defaultValue="week">
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="quarter">Quarter</TabsTrigger>
          </TabsList>
          <TabsContent value="week">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deploys.map((deploy) => (
                  <TableRow key={deploy.service}>
                    <TableCell className="font-medium">{deploy.service}</TableCell>
                    <TableCell className="font-mono">{deploy.version}</TableCell>
                    <TableCell>{deploy.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{deploy.duration}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
        <ToggleGroup defaultValue={["list"]}>
          <ToggleGroupItem value="list">List</ToggleGroupItem>
          <ToggleGroupItem value="board">Board</ToggleGroupItem>
          <ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
        </ToggleGroup>
        <Separator />
        <Accordion>
          <AccordionItem value="why">
            <AccordionTrigger>Why two pods?</AccordionTrigger>
            <AccordionContent>Each team keeps its own roadmap and on-call.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="when">
            <AccordionTrigger>When do they start?</AccordionTrigger>
            <AccordionContent>The first two in January, the others in March.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Section>

      <Questionnaire id="specimen" title="A questionnaire" description="Each answer is a field.">
        <Question id="layout" title="Which layout fits best?" comments>
          <Choice value="left" recommended description="Matches the current navigation">
            Left rail
          </Choice>
          <Choice value="top">Top bar</Choice>
        </Question>
        <Question id="density" title="How dense should it be?">
          <Scale min={1} max={5} labels={["Airy", "Dense"]} />
        </Question>
        <Question id="notes" title="Anything else?">
          <TextAnswer multiline />
        </Question>
      </Questionnaire>
    </Page>
  );
}
