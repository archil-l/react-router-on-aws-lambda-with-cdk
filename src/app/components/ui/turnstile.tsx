import React, { forwardRef } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useTheme } from "~/hooks/use-theme";

interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
}

export const TurnstileWidget = forwardRef<
  TurnstileInstance,
  TurnstileWidgetProps
>(({ siteKey, onVerify, onError, onExpire }, ref) => {
  return (
    <div className="flex justify-center my-4">
      <Turnstile
        ref={ref}
        siteKey={siteKey}
        onSuccess={onVerify}
        onError={onError}
        onExpire={onExpire}
        options={{ theme: "auto" }}
      />
    </div>
  );
});

TurnstileWidget.displayName = "TurnstileWidget";
