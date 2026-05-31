import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../utils/api';

interface SiteConfig {
  anonymous_upload: boolean;
  api_base_url: string;
  loaded: boolean;
  refresh: () => void;
}

const SiteConfigContext = createContext<SiteConfig>({
  anonymous_upload: false,
  api_base_url: '',
  loaded: false,
  refresh: () => {},
});

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState({ anonymous_upload: false, api_base_url: '', loaded: false });

  const refresh = useCallback(() => {
    api.get('/site-config')
      .then((res) => {
        const apiBaseUrl = res.data.api_base_url || '';
        setConfig({ anonymous_upload: res.data.anonymous_upload, api_base_url: apiBaseUrl, loaded: true });
        // Dynamically update axios baseURL if api_base_url is configured
        if (apiBaseUrl) {
          api.defaults.baseURL = apiBaseUrl;
        }
      })
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
