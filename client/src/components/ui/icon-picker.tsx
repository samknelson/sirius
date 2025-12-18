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
  type LucideIcon,
} from "lucide-react";
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
