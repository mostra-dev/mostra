import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function App() {
  return (
    <main className="p-6 space-y-4">
      <h1>Control page with a dialog and a menu to exercise triggers</h1>
      <Dialog>
        <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
        <DialogContent><DialogTitle>Hi</DialogTitle></DialogContent>
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem render={<a href="#p" />}>Profile</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </main>
  )
}

export default App
