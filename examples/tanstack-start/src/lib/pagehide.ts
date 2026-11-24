export const onPermanentPageHide = (dispose: () => void): (() => void) => {
  const unsubscribe = () => {
    window.removeEventListener("pagehide", onPageHide);
  };
  const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      unsubscribe();
      dispose();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  return unsubscribe;
};
