// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/commandpopup/CommandPopup.cxx partial
// MenuContentHandler: Help > Search Commands (.uno:CommandPopup) finds menu entries by their label
// with its menu path. The UI configuration, command labels and tooltips (vcl::CommandInfoProvider)
// and the dispatcher's state (SfxBindings::QueryState) are passed in by the caller. The popover
// itself (CommandListBox) is the web shell's. Added: each entry's menu path (m_aMenuPath), which
// upstream's m_aFullLabelWithPath does not carry beyond the separator, for the list to show; and a
// last search pass that finds labels with every word of the text in any order ("save template"
// finds "Save as Template...").

/** An entry of the menu bar's configuration (private:resource/menubar/menubar). */
export interface MenuConfigEntry { cmd?: string; sep?: boolean; items?: MenuConfigEntry[]; visible?: boolean; enabled?: boolean }

/** MenuContent */
export interface MenuContent {
  m_aCommandURL: string;
  m_aMenuLabel: string;
  m_aSearchableMenuLabel: string;
  m_aFullLabelWithPath: string;
  m_aTooltip: string;
  m_aSubMenuContent: MenuContent[];
  /** Not upstream: the labels of the menus the entry is in, joined by the separator. */
  m_aMenuPath: string;
}

/** CurrentEntry: a command found, with its label as listed (the tree view's text). */
export interface CurrentEntry { m_aCommandURL: string; m_aTooltip: string; m_aFullLabelWithPath: string; m_aMenuLabel: string; m_aMenuPath: string }

export interface CommandInfo {
  /** vcl::CommandInfoProvider::GetLabelForCommand */
  GetLabelForCommand(sCommandURL: string): string;
  /** vcl::CommandInfoProvider::GetTooltipForCommand */
  GetTooltipForCommand(sCommandURL: string): string;
  /** The slot exists (SfxSlotPool::GetUnoSlot) and its state is not DISABLED. */
  IsAvailable(sCommandURL: string): boolean;
  /** AllSettings::GetLayoutRTL */
  bRTL?: boolean;
  /** CharacterClassification::toLower in the UI locale. */
  locale?: string;
}

const emptyContent = (): MenuContent => ({ m_aCommandURL: '', m_aMenuLabel: '', m_aSearchableMenuLabel: '', m_aFullLabelWithPath: '', m_aTooltip: '', m_aSubMenuContent: [], m_aMenuPath: '' });

export class MenuContentHandler {
  m_aMenuContent: MenuContent = emptyContent();
  private m_aAdded = new Set<string>();
  private readonly m_rInfo: CommandInfo;

  constructor(xConfigData: readonly MenuConfigEntry[], rInfo: CommandInfo) {
    this.m_rInfo = rInfo;
    this.gatherMenuContent(xConfigData, this.m_aMenuContent);
  }

  gatherMenuContent(xIndexAccess: readonly MenuConfigEntry[], rMenuContent: MenuContent): void {
    const aMenuLabelSeparator = this.m_rInfo.bRTL ? ' ◂ ' : ' ▸ ';
    for (const aProperties of xIndexAccess) {
      const aNewContent = emptyContent();
      // A separator has no command URL.
      if (aProperties.sep) continue;
      aNewContent.m_aCommandURL = aProperties.cmd ?? '';
      const xIndexContainer = aProperties.items;
      const bIsVisible = aProperties.visible ?? true;
      const bIsEnabled = aProperties.enabled ?? true;

      if (!bIsEnabled || !bIsVisible) continue;

      aNewContent.m_aMenuLabel = this.m_rInfo.GetLabelForCommand(aNewContent.m_aCommandURL);

      if (rMenuContent.m_aFullLabelWithPath) aNewContent.m_aFullLabelWithPath += aMenuLabelSeparator;
      aNewContent.m_aFullLabelWithPath += aNewContent.m_aMenuLabel;
      aNewContent.m_aMenuPath = [rMenuContent.m_aMenuPath, rMenuContent.m_aMenuLabel].filter(Boolean).join(aMenuLabelSeparator);
      aNewContent.m_aSearchableMenuLabel = this.toLower(aNewContent.m_aFullLabelWithPath);

      aNewContent.m_aTooltip = this.m_rInfo.GetTooltipForCommand(aNewContent.m_aCommandURL);

      if (xIndexContainer) this.gatherMenuContent(xIndexContainer, aNewContent);

      rMenuContent.m_aSubMenuContent.push(aNewContent);
    }
  }

  findInMenu(rText: string, rCommandList: CurrentEntry[]): void {
    this.m_aAdded.clear();

    const aLowerCaseText = this.toLower(rText);

    // find submenus and menu items that start with the searched text
    const aTextStartCriterium = (rMenuContent: MenuContent, rSearchText: string) => {
      const aSearchText = ` / ${rSearchText}`;
      return rMenuContent.m_aSearchableMenuLabel.indexOf(aSearchText) > 0;
    };

    this.findInMenuRecursive(this.m_aMenuContent, aLowerCaseText, rCommandList, aTextStartCriterium);

    // find submenus and menu items that contain the searched text
    const aTextAllCriterium = (rMenuContent: MenuContent, rSearchText: string) => rMenuContent.m_aSearchableMenuLabel.indexOf(rSearchText) > 0;

    this.findInMenuRecursive(this.m_aMenuContent, aLowerCaseText, rCommandList, aTextAllCriterium);

    // Not upstream: find submenus and menu items that contain each word of the searched text.
    const aWords = aLowerCaseText.split(/\s+/).filter(Boolean);
    if (aWords.length > 1) {
      const aTextWordsCriterium = (rMenuContent: MenuContent) => aWords.every((w) => rMenuContent.m_aSearchableMenuLabel.includes(w));
      this.findInMenuRecursive(this.m_aMenuContent, aLowerCaseText, rCommandList, aTextWordsCriterium);
    }
  }

  private findInMenuRecursive(rMenuContent: MenuContent, rText: string, rCommandList: CurrentEntry[], rSearchCriterium: (c: MenuContent, s: string) => boolean): void {
    for (const aSubContent of rMenuContent.m_aSubMenuContent) {
      if (rSearchCriterium(aSubContent, rText)) this.addCommandIfPossible(aSubContent, rCommandList);
      this.findInMenuRecursive(aSubContent, rText, rCommandList, rSearchCriterium);
    }
  }

  private addCommandIfPossible(rMenuContent: MenuContent, rCommandList: CurrentEntry[]): void {
    if (this.m_aAdded.has(rMenuContent.m_aFullLabelWithPath)) return;

    const sCommandURL = rMenuContent.m_aCommandURL;
    // URLTransformer::parseStrict
    if (!sCommandURL) return;

    if (!this.m_rInfo.IsAvailable(sCommandURL)) return;

    rCommandList.push({ m_aCommandURL: sCommandURL, m_aTooltip: rMenuContent.m_aTooltip, m_aFullLabelWithPath: rMenuContent.m_aFullLabelWithPath, m_aMenuLabel: rMenuContent.m_aMenuLabel, m_aMenuPath: rMenuContent.m_aMenuPath });
    this.m_aAdded.add(rMenuContent.m_aFullLabelWithPath);
  }

  toLower(rString: string): string { return rString.toLocaleLowerCase(this.m_rInfo.locale); }
}
