import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewportSize() {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function resolveStepValue(step, isMobile, key) {
  if (!step) return undefined;
  const mobileKey = `mobile${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  return isMobile && step[mobileKey] != null ? step[mobileKey] : step[key];
}

function resolveStepSelector(step, isMobile) {
  const explicitSelector = resolveStepValue(step, isMobile, 'selector');
  if (explicitSelector) return explicitSelector;
  const targetId = resolveStepValue(step, isMobile, 'targetId');
  return targetId ? `[data-tour-id="${targetId}"]` : null;
}

function measureTarget(step, isMobile) {
  if (typeof document === 'undefined') return null;
  const selector = resolveStepSelector(step, isMobile);
  if (!selector) return null;
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const padding = Number(resolveStepValue(step, isMobile, 'padding') ?? 10);
  return {
    top: clamp(rect.top - padding, 8, window.innerHeight - 8),
    left: clamp(rect.left - padding, 8, window.innerWidth - 8),
    width: Math.min(rect.width + (padding * 2), window.innerWidth - 16),
    height: Math.min(rect.height + (padding * 2), window.innerHeight - 16),
  };
}

function getCardPosition({ rect, placement, cardSize, viewport, fallbackWidth }) {
  const margin = 12;
  const gap = 16;
  const width = cardSize.width || fallbackWidth || Math.min(380, viewport.width - (margin * 2));
  const height = cardSize.height || 280;

  if (!rect || placement === 'center') {
    return {
      top: clamp((viewport.height - height) / 2, margin, viewport.height - height - margin),
      left: clamp((viewport.width - width) / 2, margin, viewport.width - width - margin),
    };
  }

  let top = margin;
  let left = margin;

  switch (placement) {
    case 'top':
      top = rect.top - height - gap;
      left = rect.left + (rect.width / 2) - (width / 2);
      break;
    case 'left':
      top = rect.top + (rect.height / 2) - (height / 2);
      left = rect.left - width - gap;
      break;
    case 'right':
      top = rect.top + (rect.height / 2) - (height / 2);
      left = rect.left + rect.width + gap;
      break;
    case 'bottom':
    default:
      top = rect.top + rect.height + gap;
      left = rect.left + (rect.width / 2) - (width / 2);
      break;
  }

  if (top < margin) top = rect.top + rect.height + gap;
  if (top + height > viewport.height - margin) top = rect.top - height - gap;
  if (left < margin) left = margin;
  if (left + width > viewport.width - margin) left = viewport.width - width - margin;
  if (top < margin) top = margin;
  if (top + height > viewport.height - margin) top = viewport.height - height - margin;

  return { top, left };
}

export default function GuidedTour({
  open,
  steps = [],
  title = 'Tour',
  onClose,
  onFinish,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [viewport, setViewport] = useState(getViewportSize);
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const cardRef = useRef(null);

  const isMobile = viewport.width < 768;
  const activeStep = open ? steps[stepIndex] : null;
  const activePlacement = resolveStepValue(activeStep, isMobile, 'placement') || 'bottom';
  const activeTitle = resolveStepValue(activeStep, isMobile, 'title') || '';
  const activeBody = resolveStepValue(activeStep, isMobile, 'body') || '';
  const activeDetails = resolveStepValue(activeStep, isMobile, 'details') || [];
  const activeMaxWidth = Number(resolveStepValue(activeStep, isMobile, 'maxWidth') ?? 384);
  const cardWidth = Math.max(260, Math.min(activeMaxWidth, viewport.width - 24));

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const handleResize = () => setViewport(getViewportSize());
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  useEffect(() => {
    if (!open || !activeStep) return undefined;

    activeStep.onEnter?.({ isMobile, stepIndex });

    let cancelled = false;
    const timers = [];
    const baseDelay = Number(resolveStepValue(activeStep, isMobile, 'waitForTargetMs') ?? 0);
    const delays = Array.from(new Set([0, 40, 160, 320, 520].map((delay) => Math.max(0, delay + baseDelay))));

    const updateRect = () => {
      if (cancelled) return;
      setTargetRect(measureTarget(activeStep, isMobile));
    };

    delays.forEach((delay) => {
      if (delay === 0) {
        updateRect();
        return;
      }
      timers.push(window.setTimeout(updateRect, delay));
    });

    const handleReposition = () => updateRect();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open, activeStep, isMobile, stepIndex]);

  useEffect(() => {
    if (!open || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width !== cardSize.width || rect.height !== cardSize.height) {
      setCardSize({ width: rect.width, height: rect.height });
    }
  }, [open, stepIndex, viewport.width, viewport.height, cardSize.width, cardSize.height, activeBody, activeDetails.length, activeTitle]);

  const cardPosition = useMemo(
    () => getCardPosition({ rect: targetRect, placement: activePlacement, cardSize, viewport, fallbackWidth: cardWidth }),
    [targetRect, activePlacement, cardSize, viewport, cardWidth],
  );

  if (!open || !activeStep || typeof document === 'undefined') return null;

  const isLastStep = stepIndex === steps.length - 1;

  const handleClose = () => {
    onClose?.();
  };

  const handleNext = () => {
    if (isLastStep) {
      onFinish?.();
      onClose?.();
      return;
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[140]">
      {targetRect ? (
        <div
          className="pointer-events-none fixed rounded-[20px] border-2 border-red-500 bg-transparent shadow-[0_0_0_9999px_rgba(15,23,42,0.72)] transition-all duration-200"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/72" />
      )}

      <div
        ref={cardRef}
        className="pointer-events-auto fixed z-[141] rounded-[24px] border border-red-400 bg-slate-900 text-white shadow-2xl"
        style={{
          width: `${cardWidth}px`,
          top: `${cardPosition.top}px`,
          left: `${cardPosition.left}px`,
        }}
      >
        <div className="flex items-center justify-between rounded-t-[24px] bg-red-500 px-5 py-4 text-white">
          <div className="text-lg font-semibold">{stepIndex + 1} / {steps.length} {title}</div>
          <button
            type="button"
            className="rounded-full p-1 text-white transition hover:bg-white/10"
            onClick={handleClose}
            aria-label="Close tutorial"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="space-y-2">
            <div className="text-xl font-semibold leading-tight">{activeTitle}</div>
            <p className="text-sm leading-6 text-slate-200">{activeBody}</p>
          </div>

          {activeDetails.length ? (
            <ul className="space-y-2 text-sm leading-6 text-slate-200">
              {activeDetails.map((detail) => (
                <li key={detail} className="rounded-xl bg-white/5 px-3 py-2">
                  {detail}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
              disabled={stepIndex === 0}
            >
              Back
            </Button>
            <Button type="button" className="bg-red-500 text-white hover:bg-red-400" onClick={handleNext}>
              {isLastStep ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
