import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { ProjectPage } from '@/pages/ProjectPage';
import { ThankYouPage } from '@/pages/ThankYouPage';
import { MobileMenuPage } from '@/pages/MobileMenuPage';
import { Toaster } from '@/components/ui/sonner';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
        <Route path="/thank-you" element={<ThankYouPage />} />
        <Route path="/menu" element={<MobileMenuPage />} />
      </Routes>
      <Toaster 
        position="top-center"
        richColors
        toastOptions={{
          style: {
            background: '#ffb7b7',
            color: '#d02f24',
            border: 'none'
          },
        }}
      />
    </Router>
  );
}

export default App;
