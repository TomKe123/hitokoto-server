import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../utils/api';

interface SiteConfig {
  anonymous_upload: boolean;
  loaded: boolean;
  refresh: () => void;
}

const SiteConfigContext = createContext<SiteConfig>({
  anonymous_upload: false,
  loaded: false,
  refresh: () => {},
});

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState({ anonymous_upload: false, loaded: false });

  const refresh = useCallback(() => {
    api.get('/site-config')
      .then((res) => setConfig({ anonymous_upload: res.data.anonymous_upload, loaded: true }))
      .catch(() => setConfig((c) => ({ ...c, loaded: true })));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SiteConfigContext.Provider value={{ ...config, refresh }}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}
