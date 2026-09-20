import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/prisma';
import { getLevelFromPoints } from './authController';

// 获奖结算积分
const AWARD_POINTS = 50;

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
                level: true
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

export const awardWinner = async (req: AuthRequest, res: Response) => {
  const { challengeId, submissionId } = req.params;

  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId }
    });

    if (!challenge) {
      return res.status(404).json({ error: '活动不存在' });
    }

    // 未结束的活动不能评奖
    if (new Date() <= challenge.endDate) {
      return res.status(400).json({ error: '活动尚未结束，不能评奖' });
    }

    const submission = await prisma.challengeSubmission.findUnique({
      where: { id: submissionId }
    });

    // 跨活动校验：作品必须属于该活动
    if (!submission || submission.challengeId !== challengeId) {
      return res.status(404).json({ error: '作品不存在或不属于该活动' });
    }

    if (submission.isWinning) {
      return res.status(409).json({ error: '该作品已获奖，请勿重复结算' });
    }

    // 原子占位：仅当作品仍未获奖时才能置为获奖，
    // 重复或并发请求中只有一个能拿到 count=1，其余全部拒绝
    const claim = await prisma.challengeSubmission.updateMany({
      where: { id: submissionId, challengeId, isWinning: false },
      data: { isWinning: true }
    });

    if (claim.count === 0) {
      return res.status(409).json({ error: '该作品已获奖，请勿重复结算' });
    }

    try {
      // 原子累加积分，避免并发下读-改-写丢失
      const author = await prisma.user.update({
        where: { id: submission.userId },
        data: { points: { increment: AWARD_POINTS } }
      });

      const newLevel = getLevelFromPoints(author.points);
      if (newLevel !== author.level) {
        await prisma.user.update({
          where: { id: author.id },
          data: { level: newLevel }
        });
      }

      const winningSubmission = await prisma.challengeSubmission.findUnique({
        where: { id: submissionId },
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

      res.json({
        message: `评奖成功，已为作者结算 ${AWARD_POINTS} 积分`,
        awardedPoints: AWARD_POINTS,
        authorPoints: author.points,
        submission: winningSubmission
      });
    } catch (error) {
      // 结算失败则回滚获奖占位，保证不留半分状态
      await prisma.challengeSubmission.updateMany({
        where: { id: submissionId, isWinning: true },
        data: { isWinning: false }
      });
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: '评奖失败' });
  }
};
