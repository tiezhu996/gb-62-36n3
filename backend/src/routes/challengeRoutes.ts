import { Router } from 'express';
import {
  createChallenge,
  getChallenges,
  getChallengeById,
  submitChallenge,
  awardWinner
} from '../controllers/challengeController';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, adminMiddleware, createChallenge);
router.get('/', getChallenges);
router.get('/:id', getChallengeById);
router.post('/:challengeId/submit', authMiddleware, submitChallenge);
router.post('/:challengeId/submissions/:submissionId/award', authMiddleware, adminMiddleware, awardWinner);

export default router;
