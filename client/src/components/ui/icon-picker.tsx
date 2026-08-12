import { useState } from "react";
import {
  FileText,
  MessageSquare,
  Phone,
  Mail,
  User,
  Users,
  Shield,
  Lock,
  Key,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  Bell,
  Calendar,
  Clock,
  Star,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Bookmark,
  Tag,
  Folder,
  File,
  Clipboard,
  ClipboardCheck,
  Edit,
  Pencil,
  Trash,
  Search,
  Settings,
  Home,
  Building,
  Building2,
  Factory,
  Warehouse,
  Hospital,
  Landmark,
  CircleHelp,
  Store,
  MapPin,
  Globe,
  Link,
  Wallet,
  CreditCard,
  DollarSign,
  Briefcase,
  Award,
  Trophy,
  Gift,
  Package,
  Truck,
  Car,
  Plane,
  Ship,
  Train,
  Smile,
  Frown,
  Meh,
  Coffee,
  Zap,
  Sun,
  Moon,
  Cloud,
  Umbrella,
  Camera,
  Image,
  Video,
  Music,
  Headphones,
  Mic,
  Volume2,
  Wifi,
  Bluetooth,
  Battery,
  Power,
  Monitor,
  Smartphone,
  Tablet,
  Watch,
  Printer,
  Save,
  Download,
  Upload,
  Share,
  Send,
  Inbox,
  Archive,
  Layers,
  Grid,
  List,
  BarChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Crosshair,
  Navigation,
  Compass,
  Map,
  Anchor,
  Feather,
  Leaf,
  Flower2,
  TreeDeciduous,
  Mountain,
  Flame,
  Droplet,
  Wind,
  Snowflake,
  Stethoscope,
  Eye,
  Glasses,
  Pill,
  Syringe,
  Cross,
  HeartPulse,
  Bone,
  Brain,
  Ear,
  Microscope,
  Ambulance,
  BriefcaseMedical,
  Bandage,
  Accessibility,
  SmilePlus,
  Scan,
  Dna,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";

// lucide-react v0.453 has no tooth icon; render a stroke-based tooth
// outline through createLucideIcon so it matches the lucide style and
// inherits size/color props like every other icon in the set.
const Tooth: LucideIcon = createLucideIcon("Tooth", [
  [
    "path",
    {
      d: "M12 5.5c-1.074-.586-2.583-1.5-4-1.5-2.1 0-4 1.247-4 5 0 4.899 1.056 8.41 2.671 10.537.573.756 1.97.521 2.567-.236.398-.505.819-1.439 1.262-2.801.292-.771.892-1.504 1.5-1.5.602.004 1.21.737 1.5 1.5.443 1.362.864 2.295 1.262 2.8.597.759 1.994.993 2.567.237C18.944 17.41 20 13.9 20 9c0-3.74-1.908-5-4-5-1.406 0-2.926.914-4 1.5z",
      key: "tooth-outline",
    },
  ],
  ["path", { d: "M12 5.5 15 7", key: "tooth-shine" }],
]);
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";
import { Input } from "./input";

const iconMap: Record<string, LucideIcon> = {
  FileText,
  MessageSquare,
  Phone,
  Mail,
  User,
  Users,
  Shield,
  Lock,
  Key,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  Bell,
  Calendar,
  Clock,
  Star,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Bookmark,
  Tag,
  Folder,
  File,
  Clipboard,
  ClipboardCheck,
  Edit,
  Pencil,
  Trash,
  Search,
  Settings,
  Home,
  Building,
  Building2,
  Factory,
  Warehouse,
  Hospital,
  Landmark,
  CircleHelp,
  Store,
  MapPin,
  Globe,
  Link,
  Wallet,
  CreditCard,
  DollarSign,
  Briefcase,
  Award,
  Trophy,
  Gift,
  Package,
  Truck,
  Car,
  Plane,
  Ship,
  Train,
  Smile,
  Frown,
  Meh,
  Coffee,
  Zap,
  Sun,
  Moon,
  Cloud,
  Umbrella,
  Camera,
  Image,
  Video,
  Music,
  Headphones,
  Mic,
  Volume2,
  Wifi,
  Bluetooth,
  Battery,
  Power,
  Monitor,
  Smartphone,
  Tablet,
  Watch,
  Printer,
  Save,
  Download,
  Upload,
  Share,
  Send,
  Inbox,
  Archive,
  Layers,
  Grid,
  List,
  BarChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Crosshair,
  Navigation,
  Compass,
  Map,
  Anchor,
  Feather,
  Leaf,
  Flower2,
  TreeDeciduous,
  Mountain,
  Flame,
  Droplet,
  Wind,
  Snowflake,
  Stethoscope,
  Eye,
  Glasses,
  Pill,
  Syringe,
  Cross,
  HeartPulse,
  Bone,
  Brain,
  Ear,
  Microscope,
  Ambulance,
  BriefcaseMedical,
  Bandage,
  Accessibility,
  SmilePlus,
  Scan,
  Dna,
  Tooth,
};

export function getIconByName(name: string | undefined): LucideIcon | null {
  if (!name) return null;
  return iconMap[name] || null;
}

export function renderIcon(name: string | undefined, className?: string) {
  const IconComponent = getIconByName(name);
  if (!IconComponent) return null;
  return <IconComponent className={className} />;
}

interface IconPickerProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
}

export function IconPicker({ value, onChange, placeholder = "Select icon", className }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const iconNames = Object.keys(iconMap);
  const filteredIcons = search
    ? iconNames.filter((name) => name.toLowerCase().includes(search.toLowerCase()))
    : iconNames;

  const SelectedIcon = value ? iconMap[value] : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-start gap-2", className)}
        >
          {SelectedIcon ? (
            <>
              <SelectedIcon className="h-4 w-4" />
              <span>{value}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="Search icons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="p-2 max-h-64 overflow-y-auto">
          {value && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start mb-2 text-muted-foreground"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Clear selection
            </Button>
          )}
          <div className="grid grid-cols-6 gap-1">
            {filteredIcons.map((name) => {
              const Icon = iconMap[name];
              return (
                <Button
                  key={name}
                  variant={value === name ? "default" : "ghost"}
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setSearch("");
                  }}
                  title={name}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </div>
          {filteredIcons.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No icons found
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
