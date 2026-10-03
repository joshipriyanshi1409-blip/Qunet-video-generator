import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { AppLayout } from './components/AppLayout';
import { PageTransition } from './components/PageTransition';
import { RedirectIfSignedIn, RequireAuth } from './components/RequireAuth';
import { AudiencePage } from './pages/AudiencePage';
import { CreatePage } from './pages/CreatePage';
import { DnaHistoryPage } from './pages/DnaHistoryPage';
import { HookLabPage } from './pages/HookLabPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MyDNAPage } from './pages/MyDNAPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { LibraryPage } from './pages/LibraryPage';
import { RenderProgressPage } from './pages/RenderProgressPage';
import { RenderResultPage } from './pages/RenderResultPage';
import { TrendRemixPage } from './pages/TrendRemixPage';
import { VoiceCoachPage } from './pages/VoiceCoachPage';
import { useAuthStore } from './store/useAuthStore';

export function App() {
  const init = useAuthStore((state) => state.init);
  const location = useLocation();

  // One subscription for the whole app: Firebase auth state drives everything.
  useEffect(() => {
    void init();
  }, [init]);

  return (
    // `mode="wait"` so the outgoing page finishes before the incoming one starts:
    // two pages fading at once reads as a flicker rather than a transition.
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
      <Route element={<RedirectIfSignedIn />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<PageTransition><HomePage /></PageTransition>} />
          <Route path="create" element={<PageTransition><CreatePage /></PageTransition>} />
          <Route path="dna" element={<PageTransition><MyDNAPage /></PageTransition>} />
          <Route path="dna/history" element={<PageTransition><DnaHistoryPage /></PageTransition>} />
          <Route path="onboarding" element={<PageTransition><OnboardingPage /></PageTransition>} />
          <Route path="trends/remix" element={<PageTransition><TrendRemixPage /></PageTransition>} />
          <Route path="hooks" element={<PageTransition><HookLabPage /></PageTransition>} />
          <Route path="audience" element={<PageTransition><AudiencePage /></PageTransition>} />
          <Route path="voice-coach" element={<PageTransition><VoiceCoachPage /></PageTransition>} />
          <Route path="render/:jobId" element={<PageTransition><RenderProgressPage /></PageTransition>} />
          <Route path="render/:jobId/result" element={<PageTransition><RenderResultPage /></PageTransition>} />
          <Route path="library" element={<PageTransition><LibraryPage /></PageTransition>} />
          <Route path="*" element={<PageTransition><NotFoundPage /></PageTransition>} />
        </Route>
      </Route>
    </Routes>
    </AnimatePresence>
  );
}
