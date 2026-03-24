import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Room } from './pages/Room';
import { MovieSelector } from './pages/MovieSelector';
import { AlertProvider } from './components/AlertProvider';

export default function App() {
  return (
    <Router>
      <AlertProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/select-video" element={<MovieSelector />} />
        </Routes>
      </AlertProvider>
    </Router>
  );
}
