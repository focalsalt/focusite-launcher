import { useEffect, useState } from "react";
import { isOnboardingDone, markOnboardingDone, REPLAY_ONBOARDING_EVENT } from "@/components/onboarding/OnboardingGuide";
import { settingsService } from "@/services/settingsService";

/** Things asked or shown once: the onboarding guide and the location consent. */
export function useFirstRun() {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !isOnboardingDone());
  // Whether the camp may use the user's coarse location (real sunrise, sunset and weather).
  const [askLocation, setAskLocation] = useState<boolean>(false);

  useEffect(() => {
    const replay = () => setShowOnboarding(true);
    window.addEventListener(REPLAY_ONBOARDING_EVENT, replay);
    return () => window.removeEventListener(REPLAY_ONBOARDING_EVENT, replay);
  }, []);

  useEffect(() => {
    settingsService
      .getSettings()
      .then((cfg) => setAskLocation(cfg.locationEnabled == null))
      .catch(() => {});
  }, []);

  const answerLocation = (allow: boolean) => {
    setAskLocation(false);
    settingsService.updateSettings({ locationEnabled: allow }).catch((err) => console.error("Failed to save location choice:", err));
  };

  const closeOnboarding = () => setShowOnboarding(false);

  /** Someone who already has an account is not a first-time user: no guide on upgrade. */
  const skipOnboarding = () => {
    markOnboardingDone();
    setShowOnboarding(false);
  };

  return { showOnboarding, closeOnboarding, skipOnboarding, askLocation, answerLocation };
}
