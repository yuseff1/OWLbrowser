import { createStore } from '@/lib/store';

export type ReaderArticle = { title: string; url: string; byline: string; site: string; hero: string; text: string };
export const readerStore = createStore<{ loading: boolean; article: ReaderArticle | null; error: string }>({ loading: false, article: null, error: '' });
