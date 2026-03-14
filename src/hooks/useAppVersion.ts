import { useEffect, useState } from "react";
import { APP_VERSION, resolveAppVersion } from "@/lib/appVersion";

export function useAppVersion() {
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    let isMounted = true;

    void resolveAppVersion().then((resolvedVersion) => {
      if (isMounted) {
        setVersion(resolvedVersion);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return version;
}
