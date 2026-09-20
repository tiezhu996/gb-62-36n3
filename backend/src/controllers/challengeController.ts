import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/prisma';

// 获奖结算积分常量：种植挑战获奖作者固定奖励 50 积分
const WINNING_REWARD_POINTS = 50;

export const createChallenge = async (req: AuthRequest, res: Response) => {
  if (!req.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }

  const { title, description, coverImage, startDate, endDate } = req.body;

  try {
    const challenge = await prisma.challenge.create({
      data: {
        title,
        description,
        coverImage,
        startDate: new Date(startDate),
        endDate: new Date(endDate)
      }
    });

    res.status(201).json({ message: '活动创建成功', challenge });
  } catch (error) {
    res.status(500).json({ error: '创建失败' });
  }
};

export const getChallenges = async (req: Request, res: Response) => {
  const { active } = req.query;

  try {
    const where: any = {};
    if (active !== undefined) {
      where.isActive = active === 'true';
    }

    const challenges = await prisma.challenge.findMany({
      where,
      include: {
        _count: {
          select: { submissions: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ challenges });
  } catch (error) {
    res.status(500).json({ error: '获取失败' });
  }
};

export const getChallengeById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id },
      include: {
        submissions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                level: true,
                points: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: { submissions: true }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({ error: '活动不存在' });
    }

    res.json(challenge);
  } catch (error) {
    res.status(500).json({ error: '获取失败' });
  }
};

export const submitChallenge = async (req: AuthRequest, res: Response) => {
  const { challengeId } = req.params;
  const { content, images } = req.body;
  const userId = req.userId!;

  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId }
    });

    if (!challenge) {
      return res.status(404).json({ error: '活动不存在' });
    }

    const now = new Date();
    if (now < challenge.startDate || now > challenge.endDate) {
      return res.status(400).json({ error: '活动不在参与时间范围内' });
    }

    const existingSubmission = await prisma.challengeSubmission.findFirst({
      where: {
        challengeId,
        userId
      }
    });

    if (existingSubmission) {
      return res.status(400).json({ error: '您已提交过作品' });
    }

    const submission = await prisma.challengeSubmission.create({
      data: {
        challengeId,
        userId,
        content,
        images: images || []
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            level: true
          }
        }
      }
    });

    res.status(201).json({ message: '提交成功', submission });
  } catch (error) {
    res.status(500).json({ error: '提交失败' });
  }
};

// 管理员在活动结束后评选获奖作品：原子地置为获奖并给作者加 50 积分
// 重复点击、并发请求、跨活动提交都会被拒绝；任一步失败必须回滚，不能留下半分状态
export const awardWinner = async (req: AuthRequest, res: Response) => {
  const { challengeId, submissionId } = req.params;

  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId }
    });

    if (!challenge) {
      return res.status(404).json({ error: '活动不存在' });
    }

    // 活动未结束不允许评奖（严格大于结束时间才算结束）
    if (new Date() <= challenge.endDate) {
      return res.status(400).json({ error: '活动尚未结束，不能评奖' });
    }

    // 先按 submissionId 取出作品，用来区分“作品不存在”与“不属于该活动”
    const submission = await prisma.challengeSubmission.findUnique({
      where: { id: submissionId }
    });

    if (!submission) {
      return res.status(404).json({ error: '作品不存在' });
    }

    // 跨活动提交：路径上的 challengeId 与作品实际归属不一致，直接拒绝
    if (submission.challengeId !== challengeId) {
      return res.status(400).json({ error: '该作品不属于当前活动，不能评奖' });
    }

    // 已结算过的作品拒绝重复评奖
    if (submission.isWinning) {
      return res.status(409).json({ error: '该作品已获奖，请勿重复评奖' });
    }

    // 原子条件更新：只有仍是未获奖状态时才能置为获奖
    // 并发请求中至多一个 updateMany 命中，其余得到 count === 0，天然互斥
    const markWinner = await prisma.challengeSubmission.updateMany({
      where: {
        id: submissionId,
        challengeId,
        isWinning: false
      },
      data: { isWinning: true }
    });

    if (markWinner.count === 0) {
      return res.status(409).json({ error: '该作品已被其他请求评选为获奖作品' });
    }

    // 原子累加积分并同步等级，避免读-改-写在并发下丢失更新
    try {
      const updatedUser = await prisma.user.update({
        where: { id: submission.userId },
        data: { points: { increment: WINNING_REWARD_POINTS } },
        select: { id: true, username: true, points: true, level: true }
      });

      const rewardedSubmission = await prisma.challengeSubmission.findUnique({
        where: { id: submissionId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              level: true,
              points: true
            }
          }
        }
      });

      return res.json({
        message: '获奖结算成功',
        rewardPoints: WINNING_REWARD_POINTS,
        submission: rewardedSubmission,
        user: updatedUser
      });
    } catch (pointsError) {
      // 积分发放失败：回滚获奖标记，保证“获奖状态 + 积分”要么都成功要么都不变
      await prisma.challengeSubmission.updateMany({
        where: {
          id: submissionId,
          challengeId,
          isWinning: true
        },
        data: { isWinning: false }
      });
      console.error('Award points failed, rolled back winning flag:', pointsError);
      return res.status(500).json({ error: '积分发放失败，已撤销获奖标记，请重试' });
    }
  } catch (error) {
    console.error('Award winner failed:', error);
    return res.status(500).json({ error: '评奖失败' });
  }
};
