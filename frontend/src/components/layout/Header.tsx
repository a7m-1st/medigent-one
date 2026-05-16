import { useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Moon, Sun, Monitor, ChevronDown, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

type Theme = 'light' | 'dark' | 'system';

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function Header() {
  const { theme, setTheme, resolvedTheme } = useUIStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get current icon based on resolved theme
  const CurrentIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-foreground">
          Medigent One
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme Dropdown */}
        <div ref={dropdownRef} className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "flex items-center gap-2 px-3 transition-all",
              "hover:bg-background-tertiary",
              isOpen && "bg-background-tertiary"
            )}
            aria-label="Toggle theme"
          >
            <CurrentIcon className="h-4 w-4" />
            <span className="text-sm hidden sm:inline capitalize">
              {theme}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                isOpen && "rotate-180"
              )}
            />
          </Button>

          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="absolute right-0 mt-2 w-40 rounded-xl bg-card border border-border shadow-lg overflow-hidden z-50"
              >
                <div className="py-1">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const isSelected = theme === option.value;

                    return (
                      <button
                        key={option.value}
                        onClick={() => {
                          setTheme(option.value);
                          setIsOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                          "hover:bg-background-secondary",
                          isSelected && "bg-accent-light text-accent"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 text-left">{option.label}</span>
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          >
                            <Check className="h-4 w-4 text-accent" />
                          </motion.div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}