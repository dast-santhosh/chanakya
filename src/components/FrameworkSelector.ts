import {
  type AnalysisPanelId,
  loadFrameworkLibrary,
  getActiveFrameworkForPanel,
  setActiveFrameworkForPanel,
} from '../services/analysis-framework-store';
import { PanelGateReason } from '../services/panel-gating';
import type { Panel } from './Panel';
import { t } from '../services/i18n';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';


interface FrameworkSelectorOptions {
  panelId: AnalysisPanelId;
  isPremium: boolean;
  panel: Panel | null;
  note?: string;
}

export class FrameworkSelector {
  readonly el: HTMLElement;
  private select: HTMLSelectElement | null = null;
  private panelId: AnalysisPanelId;
  private popup: HTMLElement | null = null;
  private btn: HTMLButtonElement;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private note: string | undefined;

  constructor(opts: FrameworkSelectorOptions) {
    this.panelId = opts.panelId;
    this.note = opts.note;

    const btn = document.createElement('button');
    btn.className = 'icon-btn framework-settings-btn';
    setTrustedHtml(btn, trustedHtml('<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>', "legacy direct innerHTML migration"));
    this.btn = btn;

    if (opts.isPremium) {
      const select = document.createElement('select');
      select.className = 'framework-popup-select';
      this.select = select;
      this.populateOptions(select);
      select.value = getActiveFrameworkForPanel(opts.panelId)?.id ?? '';
      select.addEventListener('change', () => {
        setActiveFrameworkForPanel(opts.panelId, select.value || null);
        this.updateBtnTitle();
        this.closePopup();
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.popup) {
          this.closePopup();
        } else {
          this.openPopup();
        }
      });
    } else {
      btn.classList.add('framework-settings-btn--locked');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.panel?.showGatedCta(PanelGateReason.FREE_TIER, () => {});
      });
    }

    this.updateBtnTitle();
    this.el = btn;
  }

  private updateBtnTitle(): void {
    const fw = this.select ? getActiveFrameworkForPanel(this.panelId) : null;
    this.btn.title = fw ? t('components.frameworkSelector.titlePrefix', { name: fw.name }) : t('components.frameworkSelector.titleNone');
  }

  private openPopup(): void {
    const btnRect = this.btn.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.className = 'framework-settings-popup';
    popup.style.top = `${btnRect.bottom + 4}px`;
    popup.style.right = `${document.documentElement.clientWidth - btnRect.right}px`;

    const label = document.createElement('div');
    label.className = 'framework-settings-label';
    label.textContent = t('components.frameworkSelector.label');
    popup.appendChild(label);

    if (this.select) {
      popup.appendChild(this.select);
    }

    if (this.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'framework-settings-note';
      noteEl.textContent = this.note;
      popup.appendChild(noteEl);
    }

    document.body.appendChild(popup);
    this.popup = popup;
    this.btn.setAttribute('aria-expanded', 'true');

    const handler = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node) && e.target !== this.btn) {
        this.closePopup();
      }
    };
    this.outsideClickHandler = handler;
    setTimeout(() => document.addEventListener('click', handler), 0);
  }

  private closePopup(): void {
    if (!this.popup) return;
    if (this.select && this.popup.contains(this.select)) {
      this.popup.removeChild(this.select);
    }
    this.popup.remove();
    this.popup = null;
    this.btn.setAttribute('aria-expanded', 'false');
    if (this.outsideClickHandler) {
      document.removeEventListener('click', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private populateOptions(select: HTMLSelectElement): void {
    setTrustedHtml(select, trustedHtml('', "legacy direct innerHTML migration"));
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = t('components.frameworkSelector.defaultNeutral');
    select.appendChild(defaultOpt);

    for (const fw of loadFrameworkLibrary()) {
      const opt = document.createElement('option');
      opt.value = fw.id;
      opt.textContent = fw.name;
      select.appendChild(opt);
    }
  }

  refresh(): void {
    if (!this.select) return;
    const current = this.select.value;
    this.populateOptions(this.select);
    this.select.value = getActiveFrameworkForPanel(this.panelId)?.id ?? current;
    this.updateBtnTitle();
  }

  destroy(): void {
    this.closePopup();
  }
}
