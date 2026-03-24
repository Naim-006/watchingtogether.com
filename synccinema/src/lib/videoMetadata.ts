export interface VideoMetadata {
  title: string;
  thumbnailUrl: string;
}

export const getYouTubeVideoId = (url: string): string | null => {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?)|(shorts\/))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  // The ID is usually the last capturing group that is not one of the prefixes
  // For youtu.be/ID, match[2] is youtu.be/, match[8] is the ID
  // For watch?v=ID, match[6] is watch?, match[8] is the ID
  const id = match && match[8] ? match[8] : null;
  return (id && id.length === 11) ? id : null;
};

export const getSyncVideoMetadata = (url: string, type: string): VideoMetadata => {
  if (type === 'youtube') {
    const videoId = getYouTubeVideoId(url);
    if (videoId) {
      return {
        title: 'YouTube Video',
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
      };
    }
  }

  try {
    const urlObj = new URL(url);
    const fileName = urlObj.pathname.split('/').pop() || 'Video';
    const title = decodeURIComponent(fileName).replace(/\.[^/.]+$/, "").replace(/[_-]/g, ' ');
    return {
      title: title || 'Shared Video',
      thumbnailUrl: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=300&h=200&fit=crop&q=80'
    };
  } catch (e) {
    return {
      title: 'Shared Video',
      thumbnailUrl: 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=300&h=200&fit=crop&q=80'
    };
  }
};

export const getVideoMetadata = async (url: string, type: string): Promise<VideoMetadata> => {
  const syncData = getSyncVideoMetadata(url, type);
  
  if (type === 'youtube') {
    try {
      const response = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`);
      const data = await response.json();
      return {
        title: data.title || syncData.title,
        thumbnailUrl: syncData.thumbnailUrl
      };
    } catch (error) {
      return syncData;
    }
  }
  
  return syncData;
};
