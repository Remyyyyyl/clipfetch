type Flush = (batch: Map<string, string[]>) => void;

/**
 * Agrupa las líneas de registro de yt-dlp y las entrega en tandas.
 *
 * Con dos descargas a la vez llegaban decenas de líneas por segundo y cada una
 * disparaba un render de toda la cola.
 */
export class LogBuffer {
  private pending = new Map<string, string[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: Flush,
    private readonly delay = 150,
  ) {}

  push(jobId: string, line: string): void {
    const lines = this.pending.get(jobId) ?? [];
    lines.push(line);
    if (lines.length > 200) lines.splice(0, lines.length - 200);
    this.pending.set(jobId, lines);

    if (this.timer === null) {
      this.timer = setTimeout(() => this.drain(), this.delay);
    }
  }

  flushNow(): void {
    this.drain();
  }

  /** Vacía lo pendiente y cancela el temporizador; el búfer sigue utilizable. */
  dispose(): void {
    this.drain();
  }

  private drain(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;

    const batch = this.pending;
    this.pending = new Map();
    this.flush(batch);
  }
}
