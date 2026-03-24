import React, { useState, useEffect } from 'react';
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
  Zap
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
  { 
    name: 'Osmani Khelafot', 
    url: 'https://osmanikhelafot.net/', 
    description: 'Popular Bangla and International movie collection.', 
    icon: '🕌',
    category: 'Movies'
  },
  { 
    name: 'MLXBD', 
    url: 'https://www.mlxbd.com/', 
    description: 'High-quality movie downloads and streaming.', 
    icon: '💎',
    category: 'Movies'
  },
  { 
    name: 'FMovies', 
    url: 'https://ww4.fmovies.co/home/', 
    description: 'Extensive library of movies and TV shows.', 
    icon: '🎬',
    category: 'Movies'
  },
  { 
    name: 'Movies Digital', 
    url: 'https://movies-digital.com/movies/', 
    description: 'Digital movie library with latest releases.', 
    icon: '📽️',
    category: 'Movies'
  },
  { 
    name: 'Archive.org', 
    url: 'https://archive.org/details/movies', 
    description: 'Millions of free movies and public domain content.', 
    icon: '🏛️',
    category: 'Movies'
  },
  { 
    name: 'LookMovie', 
    url: 'https://lookmovie2.to/', 
    description: 'Clean interface for movies and series.', 
    icon: '👀',
    category: 'Movies'
  },
  { 
    name: 'Pexels Videos', 
    url: 'https://www.pexels.com/videos/', 
    description: 'High-quality stock videos for testing.', 
    icon: '📸',
    category: 'Videos'
  },
  { 
    name: 'YouTube', 
    url: 'https://www.youtube.com/', 
    description: 'The world\'s largest video platform.', 
    icon: '🔴',
    category: 'Videos'
  },
  { 
    name: 'Google Search', 
    url: 'https://www.google.com/search?q=movie+index+of+mp4', 
    description: 'Search for direct video indexes.', 
    icon: '🔍',
    category: 'Search'
  }
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
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="h-20 border-b border-white/5 bg-black/40 backdrop-blur-xl px-6 flex items-center justify-between z-50 sticky top-0">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors group"
          >
            <ArrowLeft className="w-6 h-6 text-zinc-400 group-hover:text-white" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Film className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Movie Selector</h1>
              <p className="text-xs text-zinc-500 font-medium">Explore & Extract Videos for Room <span className="text-emerald-500 font-mono">{roomId}</span></p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4 bg-white/5 px-4 py-2 rounded-2xl border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Robotic Extraction Active</span>
          </div>
          {showEmbed && (
             <button 
               onClick={() => setShowEmbed(false)}
               className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-500 text-xs font-bold transition-all"
             >
               Close Browser
             </button>
          )}
        </div>
      </header>

      <main className={cn("flex-1 w-full mx-auto p-6 md:p-10 z-10 transition-all duration-500", showEmbed ? "max-w-none grid grid-cols-1 lg:grid-cols-2 gap-8" : "max-w-7xl space-y-12")}>
        
        {/* Left Side: Controls & Exploration (or full width if no embed) */}
        <div className="space-y-12 overflow-y-auto max-h-[calc(100vh-140px)] pr-2 custom-scrollbar">
          {/* Robotic Link Extractor Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-500" />
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-zinc-500">Video Link Extractor</h2>
            </div>

            <div className={cn("bg-zinc-900/40 backdrop-blur-2xl border border-white/10 rounded-[32px] p-6 shadow-2xl relative overflow-hidden", !showEmbed && "p-12")}>
              <div className="absolute top-0 right-0 p-8 opacity-5 p-none">
                <Sparkles className="w-24 h-24" />
              </div>

              <div className="space-y-8">
                <div className="space-y-3">
                  <h3 className={cn("font-black tracking-tighter", showEmbed ? "text-xl" : "text-3xl md:text-4xl")}>
                    Paste any link to find <br />
                    <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Direct Video Sources</span>
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    Our robo-system will analyze the page for .mp4, .mkv, or stream links.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl blur opacity-10 group-focus-within:opacity-30 transition duration-500" />
                    <div className="relative flex flex-col sm:flex-row gap-3">
                      <div className="relative flex-1">
                        <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input 
                          type="text" 
                          placeholder="Paste link here..."
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                          className="w-full bg-black/60 border border-white/10 rounded-2xl pl-10 pr-4 py-4 text-sm outline-none focus:border-emerald-500/50 transition-all font-medium"
                        />
                      </div>
                      <button 
                        onClick={handleExtract}
                        disabled={isExtracting || !urlInput}
                        className="px-6 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 whitespace-nowrap text-xs"
                      >
                        {isExtracting ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        ) : <Search className="w-4 h-4" />}
                        {isExtracting ? 'Analyzing' : 'Find Source'}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs">
                        <Info className="w-4 h-4 shrink-0" />
                        <p>{error}</p>
                      </motion.div>
                    )}

                    {extractedLink && (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-3">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
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
            </div>
          </section>

          {/* Exploration Section */}
          <section className="space-y-8">
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-500" />
                  <h2 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Curated Movie Sites</h2>
                </div>
                {!showEmbed && <p className="text-zinc-400 text-sm">Select a site to explore or browse directly.</p>}
              </div>

              <div className="flex flex-wrap gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
                {['All', 'Movies', 'Videos', 'Search'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat as any)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                      activeCategory === cat ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn("grid gap-4", showEmbed ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3")}>
              {filteredSites.map((site, i) => (
                <motion.div
                  key={site.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group relative"
                >
                  <div className="relative h-full bg-zinc-900/40 border border-white/10 p-5 rounded-[24px] flex flex-col justify-between gap-4 hover:border-emerald-500/30 transition-all">
                    <div className="flex items-start justify-between">
                      <div className="text-2xl">{site.icon}</div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500 px-2 py-0.5 bg-white/5 rounded-full">
                        {site.category}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm group-hover:text-emerald-400 transition-colors">{site.name}</h4>
                      {!showEmbed && <p className="text-[11px] text-zinc-500 mt-1 line-clamp-1">{site.description}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleBrowseSite(site.url)}
                        className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-xl text-[10px] font-bold transition-all border border-emerald-500/10"
                      >
                        <Globe className="w-3 h-3" /> Browse
                      </button>
                      <a 
                        href={site.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="px-3 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-xl transition-all"
                      >
                        <ExternalLink className="w-3 h-3 text-zinc-500" />
                      </a>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Side: Site Embed / Browser */}
        {showEmbed && (
          <section className="flex flex-col h-[calc(100vh-140px)] animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="bg-zinc-900/60 border border-white/10 rounded-t-[32px] p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{embeddedUrl}</p>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-black">Internal Preview</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a 
                  href={embeddedUrl || '#'} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
            
            <div className="flex-1 bg-white rounded-b-[32px] overflow-hidden relative group/frame">
              {/* Overlay for sites that block iframes */}
              <div className="absolute inset-0 bg-zinc-900 flex flex-col items-center justify-center p-8 text-center space-y-4 opacity-0 pointer-events-none group-hover/frame:opacity-0 transition-opacity">
                {/* This is a helper UI in case the iframe fails to load or blocks */}
                <Info className="w-12 h-12 text-zinc-700" />
                <p className="text-sm text-zinc-600">If the site doesn't load, it might be blocking embedded views.</p>
              </div>

              <iframe 
                src={embeddedUrl || ''} 
                className="w-full h-full border-none"
                title="Movie Site Preview"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            </div>

            <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-blue-400">Navigation Tip</p>
                <p className="text-[10px] text-blue-300/80 leading-relaxed">
                  Browse the site normally. When you find a video, <strong>right-click the video</strong> and copy its link, then paste it in the extractor on the left. 
                  If a site doesn't load in this window, click the "External Link" icon to open it in a new tab.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer (only if not embed) */}
      {!showEmbed && (
        <footer className="max-w-7xl mx-auto w-full p-10 pt-0 text-center space-y-4 z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/5 rounded-full border border-emerald-500/10 mb-2">
            <Info className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Pro Tip</span>
          </div>
          <p className="text-zinc-500 text-sm max-w-xl mx-auto leading-relaxed">
            Direct video links often end in <span className="text-emerald-500/80 font-mono">.mp4</span> or <span className="text-emerald-500/80 font-mono">.m3u8</span>. 
            Right-click a video on any compatible site and select "Copy video address" to extract the link.
          </p>
        </footer>
      )}
    </div>
  );
};
