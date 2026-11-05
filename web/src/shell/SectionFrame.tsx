import { Component, Suspense, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, Notice } from '../ui';

export function SectionLoading() {
  return (
    <div className="section-loading" aria-label="Загрузка">
      <Loader2 className="spin" />
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`Раздел «${this.props.name}» упал:`, error);
  }
  render() {
    if (this.state.error)
      return (
        <Card>
          <Notice tone="bad" title={`Раздел «${this.props.name}» не открылся`}>
            {this.state.error.message}
          </Notice>
        </Card>
      );
    return this.props.children;
  }
}

/** Обёртка раздела: ошибка одного раздела не ломает остальные. */
export function SectionFrame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Boundary name={name}>
      <Suspense fallback={<SectionLoading />}>{children}</Suspense>
    </Boundary>
  );
}
