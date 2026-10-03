import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { motionTokens } from '../theme/tokens';

/**
 * Page transition.
 *
 * A short fade-and-lift on every route change, so navigating never feels like a
 * hard cut. The animation is deliberately under 250ms: anything longer reads as
 * lag, and a creator moving between screens quickly should never wait for the
 * chrome.
 *
 * `prefers-reduced-motion` is honoured globally by `MotionConfig` in `main.tsx`,
 * which makes Motion skip the animation rather than the component having to
 * check the media query itself.
 */
export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: motionTokens.base, ease: motionTokens.ease }}
    >
      {children}
    </motion.div>
  );
}
