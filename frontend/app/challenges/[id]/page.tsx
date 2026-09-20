'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { challengeApi, uploadApi } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/time';
import { Challenge } from '@/types';
import { 
  ArrowLeft, 
  Trophy, 
  Calendar, 
  Users,
  Plus,
  X,
  Send,
  User as UserIcon
} from 'lucide-react';

export default function ChallengeDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const challengeId = Array.isArray(rawId) ? rawId[0] : rawId;
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitContent, setSubmitContent] = useState('');
  const [submitImages, setSubmitImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  // 正在结算的作品 ID，以及评奖失败时的明确冲突提示
  const [awardingId, setAwardingId] = useState<string | null>(null);
  const [awardError, setAwardError] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (challengeId) {
      loadChallenge();
    }
  }, [challengeId]);

  const loadChallenge = async () => {
    try {
      if (!challengeId) return;
      const res = await challengeApi.getById(challengeId);
      setChallenge(res.data);
    } catch (error) {
      router.push('/challenges');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const fileList = Array.from(files);
      const res = await uploadApi.uploadMultiple(fileList);
      setSubmitImages(prev => [...prev, ...res.data.urls]);
    } catch (error) {
      alert('图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (index: number) => {
    setSubmitImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!submitContent.trim() && submitImages.length === 0) {
      alert('请输入内容或添加图片');
      return;
    }

    if (!challenge) return;

    setSubmitting(true);
    try {
      await challengeApi.submit(challenge.id, {
        content: submitContent,
        images: submitImages
      });
      setShowSubmit(false);
      setSubmitContent('');
      setSubmitImages([]);
      loadChallenge();
      alert('提交成功！');
    } catch (error: any) {
      alert(error.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 管理员点选获奖：成功后刷新详情页，使获奖作品、积分和冲突状态保持一致
  const handleAward = async (submissionId: string) => {
    if (!challenge) return;
    if (!window.confirm('确定将该作品评选为获奖作品？作者将获得 50 积分，且不可重复评选。')) {
      return;
    }

    setAwardError(null);
    setAwardingId(submissionId);
    try {
      await challengeApi.award(challenge.id, submissionId);
      await loadChallenge();
      alert('获奖结算成功，作者积分 +50');
    } catch (error: any) {
      // 409 为重复/并发冲突，400 为未结束或跨活动，均给出明确提示
      const msg = error.response?.data?.error || '评奖失败';
      setAwardError(msg);
      await loadChallenge();
    } finally {
      setAwardingId(null);
    }
  };

  if (loading || !challenge) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  }

  const now = new Date();
  const isActive = now >= new Date(challenge.startDate) && now <= new Date(challenge.endDate);
  const isEnded = now > new Date(challenge.endDate);
  const winningSubmissions = challenge.submissions?.filter(s => s.isWinning) || [];

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex items-center space-x-4 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-2xl font-bold text-gray-800">{challenge.title}</h1>
      </div>

      <div className="card p-6">
        {challenge.coverImage && (
          <img
            src={challenge.coverImage}
            alt={challenge.title}
            className="w-full h-48 object-cover rounded-lg mb-4"
          />
        )}

        <div className="flex items-center space-x-4 mb-4">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            isActive 
              ? 'bg-green-100 text-green-600' 
              : 'bg-gray-100 text-gray-500'
          }`}>
            {isActive ? '🔥 进行中' : '已结束'}
          </span>
          <span className="flex items-center space-x-1 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            <span>{formatDate(challenge.startDate)} - {formatDate(challenge.endDate)}</span>
          </span>
          <span className="flex items-center space-x-1 text-sm text-gray-500">
            <Users className="w-4 h-4" />
            <span>{challenge._count?.submissions || 0} 人参与</span>
          </span>
        </div>

        <p className="text-gray-700 whitespace-pre-wrap">{challenge.description}</p>

        {isActive && (
          <button
            onClick={() => setShowSubmit(true)}
            className="mt-6 w-full btn-primary py-3 flex items-center justify-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>提交作品</span>
          </button>
        )}
      </div>

      {showSubmit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-lg">提交作品</h3>
              <button
                onClick={() => setShowSubmit(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <textarea
                value={submitContent}
                onChange={(e) => setSubmitContent(e.target.value)}
                className="input-field min-h-[120px] resize-y"
                placeholder="分享你的种植过程和心得..."
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  成果图片
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {submitImages.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img
                        src={img}
                        alt=""
                        className="w-full aspect-square object-cover rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  
                  {submitImages.length < 9 && (
                    <label className="w-full aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-green-500">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleImageUpload}
                        className="hidden"
                        disabled={uploading}
                      />
                      <Plus className="w-6 h-6 text-gray-400" />
                      <span className="text-xs text-gray-500 mt-1">
                        {uploading ? '上传中...' : '添加图片'}
                      </span>
                    </label>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || uploading}
                className="w-full btn-primary py-3 disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                <Send className="w-5 h-5" />
                <span>{submitting ? '提交中...' : '提交'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {awardError && (
        <div className="mt-3 mb-1 px-4 py-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex items-center justify-between">
          <span>⚠️ {awardError}</span>
          <button
            onClick={() => setAwardError(null)}
            className="text-red-400 hover:text-red-600 ml-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isEnded && winningSubmissions.length > 0 && (
        <div className="card p-4 mt-4 border-yellow-200 bg-yellow-50">
          <h3 className="font-bold text-yellow-700 mb-2 flex items-center">
            <Trophy className="w-5 h-5 mr-2" />
            获奖作品（{winningSubmissions.length}）· 每件奖励结算积分 50
          </h3>
          <div className="space-y-1">
            {winningSubmissions.map(s => (
              <div key={s.id} className="flex items-center justify-between text-sm text-yellow-800">
                <span>🏆 {s.user.username}</span>
                <span className="font-medium">+50 积分（当前 {s.user.points ?? '-'}）</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {challenge.submissions && challenge.submissions.length > 0 && (
        <div className="card p-6 mt-4">
          <h3 className="font-bold text-gray-800 mb-4">
            参与作品 ({challenge.submissions.length})
          </h3>
          <div className="space-y-4">
            {challenge.submissions.map((submission) => (
              <div key={submission.id} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                    {submission.user.avatar ? (
                      <img
                        src={submission.user.avatar}
                        alt={submission.user.username}
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <UserIcon className="w-4 h-4 text-green-600" />
                    )}
                  </div>
                  <div>
                    <span className="font-medium text-gray-800">
                      {submission.user.username}
                    </span>
                    <span className={`level-badge level-${submission.user.level} ml-1`}>
                      {submission.user.level === 'SEED' && '🌰'}
                      {submission.user.level === 'SPROUT' && '🌱'}
                      {submission.user.level === 'FLOWER' && '🌸'}
                      {submission.user.level === 'TREE' && '🌳'}
                    </span>
                    <span className="text-sm text-gray-400 ml-2">
                      {formatTime(submission.createdAt)}
                    </span>
                  </div>
                  {submission.isWinning ? (
                    <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full flex items-center">
                      <Trophy className="w-3 h-3 mr-1" /> 获奖 · +50 积分
                    </span>
                  ) : user?.isAdmin && isEnded ? (
                    <button
                      onClick={() => handleAward(submission.id)}
                      disabled={awardingId === submission.id}
                      className="ml-auto px-3 py-1 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-xs rounded-full flex items-center"
                    >
                      <Trophy className="w-3 h-3 mr-1" />
                      {awardingId === submission.id ? '结算中...' : '设为获奖'}
                    </button>
                  ) : null}
                </div>
                {submission.content && (
                  <p className="text-gray-600 text-sm mb-2">{submission.content}</p>
                )}
                {submission.images && submission.images.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {submission.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt=""
                        className="w-full aspect-square object-cover rounded-lg"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
