import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DisclaimerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({
  open,
  onOpenChange,
  onAcknowledge,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 border-0 bg-background-secondary">
        <DialogHeader>
          <DialogTitle>Important Disclaimer</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-foreground-secondary leading-relaxed">
            This platform is a research prototype developed for the Gemma 4
            Good Hackathon and is not a certified medical device.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-foreground-secondary leading-relaxed py-2">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              It has not undergone regulatory clearance (such as FDA or CE)
            </li>
            <li>
              It should not be used for actual clinical diagnosis or treatment
              decisions
            </li>
            <li>
              All outputs are for educational and experimental purposes only
            </li>
          </ul>
        </div>
        <DialogFooter className="mt-4">
          <Button className='cursor-pointer bg-amber-800 hover:bg-accent text-white' onClick={onAcknowledge}>I Understand</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
