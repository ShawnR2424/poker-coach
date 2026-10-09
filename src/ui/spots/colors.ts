import type { PostflopCategory } from '../../engine/postflop/categories';

export const POSTFLOP_COLORS: Record<PostflopCategory, string> = {
  beats: '--cat-bad',
  draws: '--cat-flip',
  pays: '--cat-good',
  missed: '--cat-rest',
};
