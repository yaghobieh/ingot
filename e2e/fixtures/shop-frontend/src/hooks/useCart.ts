import { useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';

export function useCart(userId: string) {
  const { data, mutate } = useSWR(`/cart/${userId}`);

  const addItem = (id) => api.post('/cart', { id });

  return { items: data?.items ?? [], addItem };
}

// TODO(agent): add removeItem with the same rollback strategy
