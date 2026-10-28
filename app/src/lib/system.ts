import { Activity, BookOpen, Fingerprint, FolderGit2, Images, Inbox, Palette, Terminal, type LucideIcon } from "lucide-react";

// The pages under System (app/system): everything that isn't a daily place or a project. The sidebar marks
// System as current on any of them.
export type SystemPage = { href: string; title: string; detail: string; icon: LucideIcon };
export const systemPages: SystemPage[] = [
  { href: "/codebases", title: "Codebases", detail: "Every repo on disk and what it is", icon: FolderGit2 },
  { href: "/queue", title: "Queue", detail: "Saved questions and investigations", icon: Inbox },
  { href: "/runs", title: "Runs", detail: "Agent turns and scheduled check-ins", icon: Activity },
  { href: "/screens", title: "Screens", detail: "Screen maps for every project", icon: Images },
  { href: "/skills", title: "Skills", detail: "How agents run sessions and tasks", icon: Terminal },
  { href: "/identity", title: "Identity", detail: "Technologies, patterns and lessons", icon: Fingerprint },
  { href: "/guide", title: "Guide", detail: "How to use Master Repo", icon: BookOpen },
  { href: "/styles", title: "Styles", detail: "Style directions for the redesign", icon: Palette },
];
