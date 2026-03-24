import React, { useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Globe,
  Video,
  ExternalLink,
  ArrowLeft,
  CheckCircle2,
  Info,
  Play,
  Film,
  Sparkles,
  Link as LinkIcon,
  Zap,
  X,
  ChevronDown
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAlert } from '../components/AlertProvider';

interface MovieSite {
  name: string;
  url: string;
  description: string;
  icon: string;
  category: 'Movies' | 'Videos' | 'Search';
}

const MOVIE_SITES: MovieSite[] = [
  { name: 'Osmani Khelafot', url: 'https://osmanikhelafot.net/', description: 'Popular Bangla and International movie collection.', icon: '🕌', category: 'Movies' },
  { name: 'MLXBD', url: 'https://www.mlxbd.com/', description: 'High-quality movie downloads and streaming.', icon: '💎', category: 'Movies' },
  { name: 'FMovies', url: 'https://ww4.fmovies.co/home/', description: 'Extensive library of movies and TV shows.', icon: '🎬', category: 'Movies' },
  { name: 'Movies Digital', url: 'https://movies-digital.com/movies/', description: 'Digital movie library with latest releases.', icon: '📽️', category: 'Movies' },
  { name: 'Archive.org', url: 'https://archive.org/details/movies', description: 'Millions of free movies and public domain content.', icon: '🏛️', category: 'Movies' },
  { name: 'LookMovie', url: 'https://lookmovie2.to/', description: 'Clean interface for movies and series.', icon: '👀', category: 'Movies' },
  { name: 'Pexels Videos', url: 'https://www.pexels.com/videos/', description: 'High-quality stock videos for testing.', icon: '📸', category: 'Videos' },
  { name: 'YouTube', url: 'https://www.youtube.com/', description: "The world's largest video platform.", icon: '🔴', category: 'Videos' },
  { name: 'Google Search', url: 'https://www.google.com/search?q=movie+index+of+mp4', description: 'Search for direct video indexes.', icon: '🔍', category: 'Search' },
];

export const MovieSelector: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [urlInput, setUrlInput] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedLink, setExtractedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<'All' | 'Movies' | 'Videos' | 'Search'>('All');
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(55); // in vh
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef<number>(55);
  const { showAlert } = useAlert();

  const roomId = searchParams.get('roomId');
  const username = searchParams.get('username') || 'Guest';
  const role = searchParams.get('role') || 'host';

  const handleExtract = async () => {
    if (!urlInput) return;
    setIsExtracting(true);
    setError(null);
    setExtractedLink(null);

    setTimeout(() => {
      const isDirectVideo = /\.(mp4|mkv|mov|webm|avi|m4v)(\?.*)?$/i.test(urlInput);
      const isYouTube = /(youtube\.com|youtu\.be)/i.test(urlInput);

      if (isDirectVideo || isYouTube) {
        setExtractedLink(urlInput);
      } else {
        setError("This doesn't look like a direct video link. Please find an .mp4 link or a YouTube URL.");
      }
      setIsExtracting(false);
    }, 1500);
  };

  const handleUseVideo = (url: string) => {
    if (!roomId) {
      showAlert({ message: 'No Room ID found!', type: 'error' });
      return;
    }
    navigate(`/room/${roomId}?username=${username}&role=${role}&videoUrl=${encodeURIComponent(url)}`);
  };

  const handleBrowseSite = (url: string) => {
    setEmbeddedUrl(url);
    setShowEmbed(true);
  };

  const filteredSites = activeCategory === 'All'
    ? MOVIE_SITES
    : MOVIE_SITES.filter(s => s.category === activeCategory);

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans selection:bg-emerald-500/30 overflow-x-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-500/8 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/8 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="h-16 md:h-20 border-b border-white/5 bg-black/40 backdrop-blur-xl px-4 md:px-6 flex items-center justify-between z-50 sticky top-0">
        <div className="flex items-center gap-3 md:gap-6 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <Film className="w-4 h-4 md:w-6 md:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base md:text-xl font-bold tracking-tight truncate">Movie Selector</h1>
              <p className="text-[10px] md:text-xs text-zinc-500 hidden sm:block">
                Room <span className="text-emerald-500 font-mono">{roomId}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Robotic Extraction Active</span>
          </div>
          {showEmbed && (
            <button
              onClick={() => setShowEmbed(false)}
              className="px-3 py-1.5 md:px-4 md:py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-500 text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Close</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <main className={cn(
        "flex-1 w-full z-10 transition-all duration-500",
        showEmbed
          ? "grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-8 lg:p-8"
          : "max-w-5xl mx-auto px-4 py-6 md:px-10 md:py-10 space-y-8"
      )}>

        {/* Controls & Site List */}
        <div className={cn(
          "space-y-8",
          showEmbed && "px-4 py-6 lg:px-0 lg:py-0 overflow-y-auto max-h-[50vh] lg:max-h-[calc(100vh-120px)]"
        )}>

          {/* Link Extractor */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-500" />
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Video Link Extractor</h2>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-2xl md:rounded-3xl p-4 md:p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                <Sparkles className="w-16 h-16" />
              </div>

              <div className="space-y-5">
                {!showEmbed && (
                  <div>
                    <h3 className="text-xl md:text-3xl font-black tracking-tighter">
                      Paste any link to find{' '}
                      <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Direct Video Sources</span>
                    </h3>
                    <p className="text-zinc-400 text-xs mt-1 leading-relaxed">
                      Our robo-system will analyze the page for .mp4, .mkv, or stream links.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      type="url"
                      inputMode="url"
                      placeholder="Paste video link here..."
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                      className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-emerald-500/50 transition-all font-medium"
                    />
                  </div>
                  <button
                    onClick={handleExtract}
                    disabled={isExtracting || !urlInput}
                    className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 text-sm whitespace-nowrap"
                  >
                    {isExtracting
                      ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      : <Search className="w-4 h-4" />}
                    {isExtracting ? 'Analyzing…' : 'Find Source'}
                  </button>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs"
                    >
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>{error}</p>
                    </motion.div>
                  )}

                  {extractedLink && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <h4 className="font-bold text-sm text-emerald-400">Source Found!</h4>
                      </div>
                      <button
                        onClick={() => handleUseVideo(extractedLink)}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                      >
                        <Play className="w-4 h-4" /> Start Watch Party
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </section>

          {/* Sites Section */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-500" />
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Curated Movie Sites</h2>
              </div>

              {/* Category filter */}
              <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 overflow-x-auto scrollbar-hide">
                {(['All', 'Movies', 'Videos', 'Search'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap",
                      activeCategory === cat ? "bg-white/15 text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn(
              "grid gap-3",
              showEmbed ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
            )}>
              {filteredSites.map((site, i) => (
                <motion.div
                  key={site.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group relative"
                >
                  <div className="h-full bg-zinc-900/50 border border-white/10 p-4 rounded-2xl flex flex-col gap-3 hover:border-emerald-500/30 active:scale-[0.98] transition-all">
                    <div className="flex items-start justify-between">
                      <span className="text-xl">{site.icon}</span>
                      <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500 px-1.5 py-0.5 bg-white/5 rounded-full">
                        {site.category}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-xs group-hover:text-emerald-400 transition-colors leading-snug">{site.name}</h4>
                      <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2 hidden sm:block">{site.description}</p>
                    </div>
                    <div className="flex gap-1.5 mt-auto">
                      <button
                        onClick={() => handleBrowseSite(site.url)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 text-emerald-500 rounded-xl text-[10px] font-bold transition-all border border-emerald-500/10"
                      >
                        <Globe className="w-3 h-3" /> Browse
                      </button>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-xl transition-all"
                      >
                        <ExternalLink className="w-3 h-3 text-zinc-500" />
                      </a>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Footer tip — only when no embed */}
            {!showEmbed && (
              <div className="text-center py-4">
                <p className="text-zinc-600 text-xs leading-relaxed">
                  Direct links often end in <span className="text-emerald-500/70 font-mono">.mp4</span>.{' '}
                  Right-click a video → <em>"Copy video address"</em>.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Embed Browser — bottom sheet on mobile, side panel on desktop */}
        <AnimatePresence>
          {showEmbed && (
            <>
              {/* Mobile: bottom sheet */}
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-zinc-950 border-t border-white/10 rounded-t-3xl shadow-2xl"
                style={{ height: `${sheetHeight}vh` }}
              >
                {/* Draggable Handle */}
                <div
                  className="flex justify-center pt-3 pb-2 cursor-ns-resize touch-none select-none"
                  onMouseDown={(e) => {
                    dragStartY.current = e.clientY;
                    dragStartH.current = sheetHeight;
                    const onMove = (mv: MouseEvent) => {
                      if (dragStartY.current === null) return;
                      const delta = (dragStartY.current - mv.clientY) / window.innerHeight * 100;
                      setSheetHeight(Math.min(85, Math.max(20, dragStartH.current + delta)));
                    };
                    const onUp = () => {
                      dragStartY.current = null;
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                  onTouchStart={(e) => {
                    dragStartY.current = e.touches[0].clientY;
                    dragStartH.current = sheetHeight;
                  }}
                  onTouchMove={(e) => {
                    if (dragStartY.current === null) return;
                    const delta = (dragStartY.current - e.touches[0].clientY) / window.innerHeight * 100;
                    setSheetHeight(Math.min(85, Math.max(20, dragStartH.current + delta)));
                  }}
                  onTouchEnd={() => { dragStartY.current = null; }}
                >
                  <div className="w-12 h-1.5 bg-white/30 rounded-full" />
                </div>

                <div className="flex items-center justify-between px-4 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="w-4 h-4 text-emerald-500 shrink-0" />
                    <p className="text-[10px] text-zinc-400 truncate">{embeddedUrl}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <a href={embeddedUrl || '#'} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-400">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button onClick={() => setShowEmbed(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 bg-white overflow-hidden mx-2 mb-2 rounded-2xl">
                  <iframe
                    src={embeddedUrl || ''}
                    className="w-full h-full border-none"
                    title="Movie Site Preview"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  />
                </div>
              </motion.div>

              {/* Desktop: side panel */}
              <motion.section
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                className="hidden lg:flex flex-col h-[calc(100vh-120px)]"
              >
                <div className="bg-zinc-900/60 border border-white/10 rounded-t-3xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Globe className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{embeddedUrl}</p>
                      <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-black">Internal Preview</p>
                    </div>
                  </div>
                  <a
                    href={embeddedUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white transition-colors ml-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>

                <div className="flex-1 bg-white rounded-b-3xl overflow-hidden">
                  <iframe
                    src={embeddedUrl || ''}
                    className="w-full h-full border-none"
                    title="Movie Site Preview"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  />
                </div>

                <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-start gap-3">
                  <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-300/80 leading-relaxed">
                    Browse normally. When you find a video, <strong>right-click → Copy video address</strong>, then paste it in the extractor.
                  </p>
                </div>
              </motion.section>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};
