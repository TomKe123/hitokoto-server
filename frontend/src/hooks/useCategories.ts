import { useState, useEffect } from 'react';
import api from '../utils/api';

interface Category {
  id?: number;
  name: string;
  display_name?: string;
  count?: number;
}

export default function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/categories')
      .then((res) => setCategories(res.data.categories || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { categories, loading };
}
