/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import Image from 'next/image';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------------------------------------------------------
  // 新增：验证相关状态和计时器
  // -----------------------------------------------------------------------------
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyCodeError, setVerifyCodeError] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const verifyTimerRef = useRef<NodeJS.Timeout | null>(null);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            // 检查是否有第一集的播放地址
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  };

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      await saveSkipConfig(
        currentSourceRef.current,
        currentIdRef.current,
        newConfig
      );
      setSkipConfig(newConfig);
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '0秒';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes === 0) {
      return `${remainingSeconds}秒`;
    }
    return `${minutes}分${remainingSeconds.toString().padStart(2, '0')}秒`;
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  };

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
                (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      // 重置验证状态
      setIsVerified(false);
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
      // 切换集数时重置验证状态
      setIsVerified(false);
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
      // 切换集数时重置验证状态
      setIsVerified(false);
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
      // 切换集数时重置验证状态
      setIsVerified(false);
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // 新增：验证相关函数
  // ---------------------------------------------------------------------------
  const handleVerifySubmit = async () => {
    if (verifyCode.length !== 8) {
      setVerifyCodeError('请输入8位验证码');
      return;
    }
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: verifyCode }),
      });

      const data = await response.json();

      if (data.success) {
        setShowVerifyModal(false);
        setIsVerified(true);
        if (artPlayerRef.current) {
          artPlayerRef.current.play();
        }
      } else {
        setVerifyCodeError(data.message || '验证码无效');
      }
    } catch (error) {
      console.error('验证服务请求失败:', error);
      setVerifyCodeError('验证服务连接失败');
    }
  };

  // 设置验证定时器（1-5分钟随机）
  const setupVerifyTimer = () => {
    if (isVerified || verifyTimerRef.current) return;
    
    // 随机1-5分钟（转换为毫秒）
    const randomDelay = 60000 + Math.floor(Math.random() * 240000);
    verifyTimerRef.current = setTimeout(() => {
      if (!isVerified && artPlayerRef.current) {
        artPlayerRef.current.pause();
        setShowVerifyModal(true);
      }
    }, randomDelay);
  };

  useEffect(() => {
    // 当播放器准备就绪且未验证时设置定时器
    if (artPlayerRef.current && !isVerified) {
      setupVerifyTimer();
    }

    return () => {
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
    };
  }, [artPlayerRef.current, isVerified]);

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      // 切换视频时重置验证状态并设置新定时器
      setIsVerified(false);
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
      setupVerifyTimer();
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      // 销毁播放器实例
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }

    // 隐藏错误信息
    setError(null);

    // 创建新的播放器实例
    const art = new Artplayer({
      container: artRef.current,
      url: videoUrl,
      title: `${videoTitle} - 第${currentEpisodeIndex + 1}集`,
      poster: videoCover,
      volume: lastVolumeRef.current,
      autoplay: false,
      fullscreen: false,
      fullscreenWeb: false,
      pip: true,
      hotkey: true,
      mutex: true,
      flip: true,
      rotate: true,
      playbackRate: true,
      aspectRatio: true,
      screenshot: true,
      setting: true,
      theme: '#FF0000',
      moreVideoAttr: {
        playsinline: true,
        preload: 'auto',
      },
      plugins: [],
      layers: [
        {
          html: `
            <div class="flex flex-col items-center justify-center h-full">
              <div class="text-white text-2xl mb-2">${videoTitle}</div>
              <div class="text-white text-xl">第${currentEpisodeIndex + 1}集</div>
            </div>
          `,
          click: () => art.play(),
          style: {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 5,
          },
        },
      ],
      controls: [
        {
          position: 'right',
          html: `<button class="art-control art-control--text" title="收藏">
            <i class="art-icon"><Heart size={18} /></i>
            <span class="art-control-text">${favorited ? '已收藏' : '收藏'}</span>
          </button>`,
          click: handleToggleFavorite,
        },
        {
          position: 'right',
          html: `<button class="art-control art-control--text" title="跳过片头片尾">
            <i class="art-icon">⏭️</i>
            <span class="art-control-text">跳过</span>
          </button>`,
          click: () => {
            if (!skipConfigRef.current.enable) return;
            
            const player = artPlayerRef.current;
            if (!player) return;
            
            const currentTime = player.currentTime;
            const duration = player.duration;
            
            if (currentTime < skipConfigRef.current.intro_time) {
              player.currentTime = skipConfigRef.current.intro_time;
            } else if (duration - currentTime < skipConfigRef.current.outro_time) {
              player.currentTime = duration - 5; // 跳到结尾前5秒
            }
          },
        },
      ],
    });

    // 保存播放器引用
    artPlayerRef.current = art;

    // 保存音量
    art.on('volume', (volume: number) => {
      lastVolumeRef.current = volume;
    });

    // 视频元数据加载完成后
    art.on('loadedmetadata', () => {
      // 自动跳过片头片尾
      if (skipConfigRef.current.enable) {
        const currentTime = art.currentTime;
        if (currentTime < skipConfigRef.current.intro_time) {
          art.currentTime = skipConfigRef.current.intro_time;
        }
      }

      // 恢复播放进度
      if (resumeTimeRef.current && resumeTimeRef.current > 0) {
        art.currentTime = resumeTimeRef.current;
        resumeTimeRef.current = null;
      }

      // 隐藏加载状态
      setIsVideoLoading(false);
    });

    // 视频开始播放后
    art.on('play', () => {
      // 设置定时保存播放进度（每30秒）
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
      saveIntervalRef.current = setInterval(() => {
        const now = Date.now();
        // 确保至少间隔10秒保存一次
        if (now - lastSaveTimeRef.current > 10000) {
          saveCurrentPlayProgress();
        }
      }, 30000);
      
      // 如果未验证，设置验证定时器
      if (!isVerified) {
        setupVerifyTimer();
      }
    });

    // 视频暂停后
    art.on('pause', () => {
      // 暂停时保存播放进度
      saveCurrentPlayProgress();
      
      // 清除验证定时器
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
    });

    // 视频结束后
    art.on('ended', () => {
      // 保存播放进度
      saveCurrentPlayProgress();
      
      // 自动播放下一集
      if (
        detailRef.current &&
        currentEpisodeIndexRef.current < detailRef.current.episodes.length - 1
      ) {
        setTimeout(() => {
          handleNextEpisode();
        }, 1000);
      }
    });

    // 视频错误处理
    art.on('error', (error: any) => {
      console.error('视频播放错误:', error);
      setError('视频播放错误，请尝试切换播放源或选集');
      setIsVideoLoading(false);
    });

    // 视频加载状态变化
    art.on('waiting', () => {
      setIsVideoLoading(true);
    });

    art.on('playing', () => {
      setIsVideoLoading(false);
    });

    // 处理HLS流媒体
    const videoElement = art.video as HTMLVideoElement;
    ensureVideoSource(videoElement, videoUrl);

    // 支持HLS流媒体
    if (Hls.isSupported() && videoUrl.endsWith('.m3u8')) {
      // 销毁旧的HLS实例（如果存在）
      if (videoElement.hls) {
        videoElement.hls.destroy();
      }

      // 创建新的HLS实例
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startLevel: -1,
        autoStartLoad: false,
        loader: CustomHlsJsLoader,
      });

      // 保存HLS实例引用
      videoElement.hls = hls;

      // 监听HLS事件
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest loaded and parsed');
        art.load();
      });

      hls.on(Hls.Events.ERROR, (event: any, data: any) => {
        console.error('HLS error:', event, data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('尝试恢复网络错误...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('尝试恢复媒体错误...');
              hls.recoverMediaError();
              break;
            default:
              console.log('无法恢复的错误，销毁HLS实例');
              hls.destroy();
              videoElement.hls = null;
              setError('视频加载失败，请尝试切换播放源');
              setIsVideoLoading(false);
              break;
          }
        }
      });

      // 加载HLS流
      hls.loadSource(videoUrl);
      hls.attachMedia(videoElement);
    }

    // 显示视频加载状态
    setIsVideoLoading(true);
    setVideoLoadingStage('initing');
  }, [videoUrl, loading, currentEpisodeIndex, artRef.current]);

  // 监听跳过配置变化，更新UI
  useEffect(() => {
    if (!artPlayerRef.current) return;
    
    const skipButton = artPlayerRef.current.template.querySelector(
      '.art-control-text:contains("跳过")'
    );
    
    if (skipButton) {
      skipButton.innerHTML = skipConfig.enable 
        ? '跳过' 
        : '跳过(未启用)';
      skipButton.classList.toggle('opacity-50', !skipConfig.enable);
    }
  }, [skipConfig.enable]);

  // 监听去广告开关变化，更新localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('enable_blockad', blockAdEnabled.toString());
    }
  }, [blockAdEnabled]);

  // 处理页面卸载
  useEffect(() => {
    return () => {
      // 保存播放进度
      saveCurrentPlayProgress();
      
      // 清理播放器
      if (artPlayerRef.current) {
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      }
      
      // 清理定时器
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
      
      if (verifyTimerRef.current) {
        clearTimeout(verifyTimerRef.current);
      }
    };
  }, []);

  // 渲染函数
  return (
    <PageLayout title={videoTitle || '视频播放'}>
      <div className="min-h-screen bg-gray-900 text-white">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-50 bg-gray-800/80 backdrop-blur-md border-b border-gray-700">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => router.back()}
                className="flex items-center text-gray-300 hover:text-white transition-colors"
              >
                <i className="fa fa-arrow-left mr-2"></i>
                <span>返回</span>
              </button>
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-white truncate max-w-[200px] md:max-w-[400px]">
                {videoTitle}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed);
                }}
                className="flex items-center text-gray-300 hover:text-white transition-colors"
              >
                <i className="fa fa-th-list mr-2"></i>
                <span>选集</span>
              </button>
            </div>
          </div>
        </header>

        {/* 主要内容区 */}
        <main className="container mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
          {/* 左侧：视频播放器 */}
          <div className="lg:w-2/3">
            {/* 播放器容器 */}
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden shadow-xl">
              {/* 加载状态 */}
              {loading || isVideoLoading ? (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500 mb-4"></div>
                  <p className="text-white text-lg">
                    {loading ? loadingMessage : '加载中...'}
                  </p>
                  {videoLoadingStage === 'sourceChanging' && (
                    <p className="text-white text-sm mt-2">正在切换播放源...</p>
                  )}
                </div>
              ) : null}

              {/* 错误状态 */}
              {error ? (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
                  <div className="text-red-500 text-4xl mb-4">
                    <i className="fa fa-exclamation-triangle"></i>
                  </div>
                  <p className="text-white text-lg mb-2">{error}</p>
                  <button
                    onClick={() => setError(null)}
                    className="mt-4 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                  >
                    重试
                  </button>
                </div>
              ) : null}

              {/* 播放器 */}
              <div ref={artRef} className="w-full h-full"></div>
            </div>

            {/* 视频信息 */}
            <div className="mt-4 bg-gray-800/50 rounded-lg p-4 backdrop-blur-sm">
              <h2 className="text-xl font-bold mb-2">{videoTitle}</h2>
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm">
                  {detail?.year || '未知年份'}
                </span>
                <span className="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm">
                  {detail?.source_name || '未知来源'}
                </span>
                <span className="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm">
                  第{currentEpisodeIndex + 1}集 / 共{totalEpisodes}集
                </span>
              </div>
              <p className="text-gray-400 text-sm">{detail?.desc || '暂无简介'}</p>
            </div>

            {/* 选集控制 */}
            <div className="mt-6 flex justify-between items-center bg-gray-800/50 rounded-lg p-4 backdrop-blur-sm">
              <button
                onClick={handlePreviousEpisode}
                className="flex items-center bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={currentEpisodeIndex <= 0}
              >
                <i className="fa fa-step-backward mr-2"></i>
                <span>上一集</span>
              </button>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    if (artPlayerRef.current) {
                      artPlayerRef.current.currentTime -= 30;
                    }
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
                >
                  <i className="fa fa-backward"></i>
                </button>
                
                <button
                  onClick={() => {
                    if (artPlayerRef.current) {
                      artPlayerRef.current.toggle();
                    }
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg transition-colors"
                >
                  <i className="fa fa-play"></i>
                </button>
                
                <button
                  onClick={() => {
                    if (artPlayerRef.current) {
                      artPlayerRef.current.currentTime += 30;
                    }
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
                >
                  <i className="fa fa-forward"></i>
                </button>
              </div>
              
              <button
                onClick={handleNextEpisode}
                className="flex items-center bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={currentEpisodeIndex >= totalEpisodes - 1}
              >
                <span>下一集</span>
                <i className="fa fa-step-forward ml-2"></i>
              </button>
            </div>
          </div>

          {/* 右侧：选集列表 */}
          <div className="lg:w-1/3 bg-gray-800/50 rounded-lg overflow-hidden shadow-lg backdrop-blur-sm">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="font-bold text-lg">选集列表</h3>
              <div className="flex items-center space-x-2">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blockAdEnabled}
                    onChange={() => setBlockAdEnabled(!blockAdEnabled)}
                    className="form-checkbox h-4 w-4 text-red-500 rounded border-gray-300 focus:ring-red-500"
                  />
                  <span className="ml-2 text-sm text-gray-300">去广告</span>
                </label>
                
                <button
                  onClick={() => {
                    setShowVerifyModal(true);
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-colors"
                >
                  验证
                </button>
              </div>
            </div>
            
            {/* 选集列表 */}
            <div className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
              {detail && (
                <EpisodeSelector
                  episodes={detail.episodes}
                  currentIndex={currentEpisodeIndex}
                  onEpisodeChange={handleEpisodeChange}
                  source={currentSource}
                  id={currentId}
                  availableSources={availableSources}
                  onSourceChange={handleSourceChange}
                  precomputedVideoInfo={precomputedVideoInfo}
                />
              )}
            </div>
            
            {/* 跳过片头片尾设置 */}
            <div className="p-4 border-t border-gray-700">
              <h4 className="font-medium mb-3">跳过片头片尾设置</h4>
              <div className="space-y-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="skipConfig"
                    checked={skipConfig.enable}
                    onChange={(e) =>
                      handleSkipConfigChange({
                        ...skipConfig,
                        enable: e.target.checked,
                      })
                    }
                    className="form-checkbox h-4 w-4 text-red-500 rounded border-gray-300 focus:ring-red-500"
                  />
                  <label htmlFor="skipConfig" className="ml-2 text-sm text-gray-300">
                    启用跳过功能
                  </label>
                </div>
                
                {skipConfig.enable && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">
                        片头结束时间
                      </label>
                      <div className="flex items-center">
                        <input
                          type="range"
                          min="0"
                          max="300"
                          value={skipConfig.intro_time}
                          onChange={(e) =>
                            handleSkipConfigChange({
                              ...skipConfig,
                              intro_time: parseInt(e.target.value),
                            })
                          }
                          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="ml-2 text-sm text-gray-400">
                          {formatTime(skipConfig.intro_time)}
                        </span>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">
                        片尾开始时间
                      </label>
                      <div className="flex items-center">
                        <input
                          type="range"
                          min="0"
                          max="300"
                          value={skipConfig.outro_time}
                          onChange={(e) =>
                            handleSkipConfigChange({
                              ...skipConfig,
                              outro_time: parseInt(e.target.value),
                            })
                          }
                          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="ml-2 text-sm text-gray-400">
                          {formatTime(skipConfig.outro_time)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
        
        {/* 验证模态框 */}
        {showVerifyModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 transform transition-all">
              <div className="text-center mb-4">
                <div className="text-red-500 text-4xl mb-2">
                  <i className="fa fa-lock"></i>
                </div>
                <h3 className="text-xl font-bold text-white">验证身份</h3>
                <p className="text-gray-400 mt-2">请输入验证码以继续观看</p>
              </div>
              
              {verifyCodeError && (
                <div className="text-red-500 text-sm mb-3 text-center">
                  {verifyCodeError}
                </div>
              )}
              
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="请输入8位验证码"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  maxLength={8}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowVerifyModal(false)}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleVerifySubmit}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg transition-colors"
                >
                  验证
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

export default PlayPageClient;
