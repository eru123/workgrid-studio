import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface Props {
    label: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}

export function ContextSubmenu({ label, icon, children }: Props) {
    const [open, setOpen] = useState(false);

    return (
        <div
            className="relative"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2">
                {icon}
                <span className="flex-1">{label}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground/60 ml-auto" />
            </button>

            {open && (
                <div className="absolute left-full top-0 ml-0.5 min-w-[180px] bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs z-[101]">
                    {children}
                </div>
            )}
        </div>
    );
}
