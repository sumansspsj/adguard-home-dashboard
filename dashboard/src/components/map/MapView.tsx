import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ClientConfig } from './types';
import { AtlasMap, type Padding } from './AtlasMap';
import type { AtlasStore, Place, Selection, Theme } from './store';

export interface MapViewHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

interface Props {
  store: AtlasStore;
  config: ClientConfig;
  padding: Padding;
  places: Place[];
  selection: Selection;
  paused: boolean;
  theme: Theme;
  labels: number;
  className?: string;
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(
  {
    store,
    config,
    padding,
    places,
    selection,
    paused,
    theme,
    labels,
    className = '',
  }: Props,
  ref
) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AtlasMap | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => map.current?.zoomIn(),
      zoomOut: () => map.current?.zoomOut(),
      resetZoom: () => map.current?.resetZoom(),
    }),
    []
  );

  useEffect(() => {
    if (!container.current) return;
    const instance = new AtlasMap(container.current, {
      home: config.home,
      onSelect: (s) => store.select(s),
    });
    map.current = instance;
    const stop = store.onLive((e) => instance.push(e));
    return () => {
      stop();
      instance.destroy();
      map.current = null;
    };
  }, [store]);

  const homeLat = config.home?.lat;
  const homeLon = config.home?.lon;
  const homeLabel = config.home?.label;
  useEffect(() => {
    if (config.home) {
      map.current?.setHome(config.home);
    }
  }, [homeLat, homeLon, homeLabel]);

  const { top, right, bottom, left } = padding;
  useEffect(() => map.current?.setPadding({ top, right, bottom, left }), [top, right, bottom, left]);
  useEffect(() => map.current?.setPlaces(places), [places]);
  useEffect(() => map.current?.setSelection(selection), [selection]);
  useEffect(() => map.current?.setPaused(paused), [paused]);
  useEffect(() => map.current?.setLabels(labels > 0, labels), [labels]);
  useEffect(() => map.current?.readTheme(), [theme]);

  return (
    <div
      className={`map relative w-full h-full overflow-hidden select-none ${className}`}
      ref={container}
      role="img"
      aria-label="World map of live DNS queries"
    />
  );
});
