import React from 'react';
import { motion } from 'framer-motion';
import { Heart, ExternalLink, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const ThankYouPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-start justify-center p-6 relative overflow-y-auto">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/10 blur-[120px] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full bg-zinc-900/50 border border-white/5 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-2xl relative z-10"
      >
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(37,99,235,0.4)]">
            <Heart className="w-8 h-8 text-white fill-white" />
          </div>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-center mb-6 bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
          Thank You!
        </h1>

        <div className="space-y-6 text-zinc-400 leading-relaxed text-center text-lg">
          <p>
            We would like to express our deepest gratitude to the <span className="text-blue-400 font-semibold">Gemma 4 Team</span> and the
            visionary <span className="text-emerald-400 font-semibold">organizers</span> for their incredible efforts in pushing the boundaries
            of medical AI.
          </p>

          <p>
            The <span className="text-zinc-100 italic">Gemma 4 Good Hackathon</span> is a testament to the power of community and innovation
            in healthcare. We are honored to be part of this journey.
          </p>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              asChild
              className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-8 h-12 shadow-lg shadow-blue-600/20"
            >
              <a
                href="https://www.kaggle.com/competitions"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                View Hackathon on Kaggle
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>

            <Button 
              variant="ghost" 
              className="text-zinc-500 hover:text-white hover:bg-white/5 rounded-xl px-8 h-12"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 flex flex-wrap justify-center gap-x-8 gap-y-4 text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-600">
          <span>Google Gemma 4</span>
          <span>Good Hackathon</span>
          <span>2026</span>
        </div>
      </motion.div>
    </div>
  );
};
