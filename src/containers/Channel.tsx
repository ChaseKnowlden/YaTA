import { Button, Classes, HotkeysTarget, Intent, Menu, NavbarDivider, Popover, Position } from '@blueprintjs/core'
import * as copy from 'copy-to-clipboard'
import * as _ from 'lodash'
import * as React from 'react'
import { Helmet } from 'react-helmet'
import { connect } from 'react-redux'
import { match } from 'react-router'
import * as ReactTooltip from 'react-tooltip'
import { compose } from 'recompose'

import ChannelDetails from 'Components/ChannelDetails'
import Chatters from 'Components/Chatters'
import CommandsHelp from 'Components/CommandsHelp'
import DropOverlay from 'Components/DropOverlay'
import FlexLayout from 'Components/FlexLayout'
import FollowOmnibar from 'Components/FollowOmnibar'
import { withHeader, WithHeaderProps } from 'Components/Header'
import HeaderChannelState from 'Components/HeaderChannelState'
import HeaderTooltip from 'Components/HeaderTooltip'
import Input from 'Components/Input'
import Logs, { Logs as InnerLogs } from 'Components/Logs'
import LogsExporter from 'Components/LogsExporter'
import ModerationMenuItems, { SlowModeDuration } from 'Components/ModerationMenuItems'
import PollEditor from 'Components/PollEditor'
import Spinner from 'Components/Spinner'
import ReadyState from 'Constants/readyState'
import { ShortcutImplementations, ShortcutType } from 'Constants/shortcut'
import Status from 'Constants/status'
import { ToggleableUI } from 'Constants/toggleable'
import BroadcasterOverlay from 'Containers/BroadcasterOverlay'
import Chat, { ChatClient } from 'Containers/Chat'
import ChatterDetails from 'Containers/ChatterDetails'
import Search from 'Containers/Search'
import Action, { ActionPlaceholder, ActionType, SerializedAction } from 'Libs/Action'
import { SerializedChatter } from 'Libs/Chatter'
import Command, { CommandDelegate, CommandDelegateAction, CommandDelegateDataFetcher } from 'Libs/Command'
import { SerializedMessage } from 'Libs/Message'
import Notice from 'Libs/Notice'
import Toaster from 'Libs/Toaster'
import Twitch from 'Libs/Twitch'
import { addToHistory, setChannel, updateHistoryIndex } from 'Store/ducks/app'
import { markChatterAsBlocked, markChatterAsUnblocked } from 'Store/ducks/chatters'
import { addLog, addMarker, isLog, Log, markAsRead, pauseAutoScroll } from 'Store/ducks/logs'
import { ApplicationState } from 'Store/reducers'
import {
  getChannel,
  getEmotes,
  getHistory,
  getHistoryIndex,
  getLastWhisperSender,
  getRoomState,
  getStatus,
} from 'Store/selectors/app'
import { getChatters } from 'Store/selectors/chatters'
import { getIsAutoScrollPaused, getLastReadId, getLogs } from 'Store/selectors/logs'
import {
  getAddWhispersToHistory,
  getAlternateMessageBackgrounds,
  getAutoFocusInput,
  getCopyMessageOnDoubleClick,
  getMarkNewAsUnread,
  getPrioritizeUsernames,
  getShortcuts,
  getShowContextMenu,
  getShowViewerCount,
} from 'Store/selectors/settings'
import { getIsMod, getLoginDetails } from 'Store/selectors/user'
import styled from 'Styled'
import { sanitizeUrlForPreview } from 'Utils/html'
import { convertMessagesToString } from 'Utils/logs'
import { renderShorcuts } from 'Utils/shortcuts'

/**
 * ChannelLink component.
 */
const ChannelLink = styled.a.attrs({
  target: '_blank',
})`
  &,
  .${Classes.DARK} & {
    color: inherit;

    &:hover {
      color: inherit;
    }
  }
`

/**
 * RegExp used to identify links to preview.
 */
const PreviewRegExp = /https?:\/\/.[\w\-\/\:\.\%\+]*\.(jpg|jpeg|png|gif|gifv)/

/**
 * React State.
 */
const initialState = {
  focusedChatter: undefined as Optional<SerializedChatter>,
  inputValue: '',
  isUploadingFile: false,
  viewerCount: undefined as Optional<number>,
  [ToggleableUI.BroadcasterOverlay]: false,
  [ToggleableUI.Chatters]: false,
  [ToggleableUI.CommandsHelp]: false,
  [ToggleableUI.FollowOmnibar]: false,
  [ToggleableUI.LogsExporter]: false,
  [ToggleableUI.PollEditor]: false,
  [ToggleableUI.Search]: false,
}
type State = Readonly<typeof initialState>

/**
 * Channel Component.
 */
class Channel extends React.Component<Props, State> {
  public state: State = initialState
  public chatClient = React.createRef<any>()
  private logsWrapper = React.createRef<HTMLElement>()
  private logsComponent = React.createRef<InnerLogs>()
  private input = React.createRef<Input>()
  private viewerCountMonitorId?: number
  private shortcuts: ShortcutImplementations

  /**
   * Creates a new instance of the component.
   * @class
   * @param props - The props of the component.
   */
  constructor(props: Props) {
    super(props)

    this.shortcuts = [
      { type: ShortcutType.CreateClip, action: this.clip },
      { type: ShortcutType.ToggleSearch, action: this.toggleSearch },
      { type: ShortcutType.ToggleOmnibar, action: this.toggleFollowOmnibar },
      { type: ShortcutType.TogglePollEditor, action: this.togglePollEditor },
      { type: ShortcutType.FocusChatInput, action: this.focusChatInput },
      { type: ShortcutType.AddMarker, action: this.props.addMarker },
    ]
  }

  /**
   * Lifecycle: componentDidMount.
   */
  public componentDidMount() {
    this.setChannel()
    this.setHeaderComponents()

    window.addEventListener('focus', this.onFocusWindow)
  }

  /**
   * Lifecycle: componentDidUpdate.
   * @param prevProps - The previous props.
   * @param prevState - The previous state.
   */
  public componentDidUpdate(prevProps: Props, prevState: State) {
    const {
      isAutoScrollPaused: prevIsAutoScrollPaused,
      isMod: prevIsMod,
      match: prevMatch,
      roomState: prevRoomState,
      showViewerCount: prevShowViewerCount,
    } = prevProps
    const { isAutoScrollPaused, isMod, roomState, showViewerCount } = this.props

    if (prevMatch.params.channel !== this.props.match.params.channel) {
      this.setChannel()
    }

    if (prevShowViewerCount !== showViewerCount || (_.isNil(prevRoomState) && !_.isNil(roomState))) {
      if (showViewerCount) {
        this.startMonitoringViewerCount()
      } else {
        this.stopMonitoringViewerCount()
      }
    }

    const { viewerCount: prevViewerCount } = prevState
    const { viewerCount } = this.state

    if (
      prevIsAutoScrollPaused !== isAutoScrollPaused ||
      prevRoomState !== roomState ||
      prevIsMod !== isMod ||
      prevViewerCount !== viewerCount
    ) {
      this.setHeaderComponents()
    }
  }

  /**
   * Lifecycle: componentWillUnmount.
   */
  public componentWillUnmount() {
    this.props.setChannel(null)

    this.props.setHeaderTitleComponent(null)
    this.props.setHeaderRightComponent(null)

    window.removeEventListener('focus', this.onFocusWindow)

    if (this.props.showViewerCount) {
      this.stopMonitoringViewerCount()
    }
  }

  /**
   * Renders the component.
   * @return Element to render.
   */
  public render() {
    const {
      focusedChatter,
      isUploadingFile,
      [ToggleableUI.BroadcasterOverlay]: showBroadcasterOverlay,
      [ToggleableUI.Chatters]: showChatters,
      [ToggleableUI.CommandsHelp]: showCommandsHelp,
      [ToggleableUI.FollowOmnibar]: showFollowOmnibar,
      [ToggleableUI.LogsExporter]: showLogsExporter,
      [ToggleableUI.PollEditor]: showPollEditor,
      [ToggleableUI.Search]: showSearch,
    } = this.state
    const {
      allLogs,
      alternateMessageBackgrounds,
      channel,
      chatters,
      copyMessageOnDoubleClick,
      lastReadId,
      loginDetails,
      markNewAsUnread,
      showContextMenu,
    } = this.props

    if (_.isNil(channel)) {
      return <Spinner large />
    }

    return (
      <FlexLayout vertical ref={this.logsWrapper as any}>
        <Helmet>
          <title>{channel} - YaTA</title>
        </Helmet>
        <ReactTooltip html effect="solid" getContent={this.getTooltipContent} className="channelTooltip" />
        <FollowOmnibar visible={showFollowOmnibar} toggle={this.toggleFollowOmnibar} />
        <Chat ref={this.chatClient} key={channel} />
        <DropOverlay
          onSuccess={this.onUploadSuccess}
          onInvalid={this.onUploadInvalid}
          onError={this.onUploadError}
          onStart={this.onUploadStart}
        />
        <Chatters toggle={this.toggleChatters} visible={showChatters} channel={channel} />
        <PollEditor toggle={this.togglePollEditor} visible={showPollEditor} />
        <LogsExporter toggle={this.toggleLogsExporter} visible={showLogsExporter} />
        <CommandsHelp toggle={this.toggleCommandsHelp} visible={showCommandsHelp} />
        <BroadcasterOverlay
          toggle={this.toggleBroadcasterOverlay}
          visible={showBroadcasterOverlay}
          unhost={this.unhost}
        />
        <Search
          copyMessageToClipboard={this.copyMessageToClipboard}
          copyMessageOnDoubleClick={copyMessageOnDoubleClick}
          toggle={this.toggleSearch}
          visible={showSearch}
        />
        <Logs
          alternateMessageBackgrounds={alternateMessageBackgrounds}
          copyMessageToClipboard={this.copyMessageToClipboard}
          copyMessageOnDoubleClick={copyMessageOnDoubleClick}
          pauseAutoScroll={this.props.pauseAutoScroll}
          scrollToNewestLog={this.scrollToNewestLog}
          copyToClipboard={this.copyToClipboard}
          deleteMessage={this.deleteMessage}
          markAsRead={this.props.markAsRead}
          markNewAsUnread={markNewAsUnread}
          showContextMenu={showContextMenu}
          actionHandler={this.handleAction}
          purgedCount={allLogs.purgedCount}
          focusChatter={this.focusChatter}
          quoteMessage={this.quoteMessage}
          canModerate={this.canModerate}
          whisper={this.prepareWhisper}
          ref={this.logsComponent}
          lastReadId={lastReadId}
          timeout={this.timeout}
          logs={allLogs.logs}
          chatters={chatters}
          unban={this.unban}
          ban={this.ban}
        />
        <Input
          disabled={this.props.status !== Status.Connected}
          username={_.get(loginDetails, 'username')}
          getCompletions={this.getCompletions}
          onChange={this.onChangeInputValue}
          isUploadingFile={isUploadingFile}
          value={this.state.inputValue}
          getHistory={this.getHistory}
          onSubmit={this.sendMessage}
          ref={this.input}
        />
        <ChatterDetails
          copyMessageToClipboard={this.copyMessageToClipboard}
          copyMessageOnDoubleClick={copyMessageOnDoubleClick}
          copyToClipboard={this.copyToClipboard}
          actionHandler={this.handleAction}
          canModerate={this.canModerate}
          unfocus={this.unfocusChatter}
          whisper={this.prepareWhisper}
          chatter={focusedChatter}
          unfollow={this.unfollow}
          unblock={this.unblock}
          timeout={this.timeout}
          follow={this.follow}
          block={this.block}
          unban={this.unban}
          ban={this.ban}
        />
      </FlexLayout>
    )
  }

  /**
   * Renders the shortcuts.
   * @return Element to render.
   */
  public renderHotkeys() {
    return renderShorcuts(this.props.shortcuts, this.shortcuts)
  }

  /**
   * Sets the current channel if necessary.
   */
  private setChannel() {
    const channel = this.props.match.params.channel.toLowerCase()

    if (this.props.match.params.channel !== this.props.channel) {
      this.props.setChannel(channel)
    }
  }

  /**
   * Returns the channel ID if any.
   * @return The channel ID.
   */
  private getChannelId() {
    return _.get(this.props.roomState, 'roomId')
  }

  /**
   * Sets the header components.
   * @return Element to render.
   */
  private setHeaderComponents() {
    const { channel, isAutoScrollPaused, isMod, loginDetails, roomState } = this.props

    const channelId = this.getChannelId()

    const connected = !_.isNil(roomState)
    const isBroadcaster = !_.isNil(loginDetails) && !_.isNil(channel) && isMod && loginDetails.username === channel

    const headerRightComponent = (
      <>
        <HeaderChannelState
          scrollToNewestLog={this.scrollToNewestLog}
          isAutoScrollPaused={isAutoScrollPaused}
          viewerCount={this.state.viewerCount}
          roomState={roomState}
        />
        <Popover position={Position.BOTTOM} usePortal={false} autoFocus={false}>
          <HeaderTooltip content="Tools">
            <Button icon="wrench" minimal />
          </HeaderTooltip>
          <Menu>
            <Menu.Divider title="Tools" />
            {connected && <Menu.Item onClick={this.clip} icon="film" text="Create clip" />}
            <Menu.Item onClick={this.togglePollEditor} icon="horizontal-bar-chart" text="Create Straw Poll" />
            {connected && <Menu.Item onClick={this.props.addMarker} icon="bookmark" text="Add marker" />}
            {connected && <Menu.Item onClick={this.toggleLogsExporter} icon="book" text="Export logs" />}
            <ModerationMenuItems
              toggleFollowersOnly={this.toggleFollowersOnly}
              toggleEmoteOnly={this.toggleEmoteOnly}
              toggleSlowMode={this.toggleSlowMode}
              toggleSubsOnly={this.toggleSubsOnly}
              clearChat={this.clearChat}
              toggleR9k={this.toggleR9k}
              roomState={roomState}
              isMod={isMod}
            />
          </Menu>
        </Popover>
        {isBroadcaster && (
          <HeaderTooltip content="Broadcaster Tools">
            <Button onClick={this.toggleBroadcasterOverlay} icon="mobile-video" minimal />
          </HeaderTooltip>
        )}
        {connected && (
          <HeaderTooltip content="Search">
            <Button onClick={this.toggleSearch} icon="search" minimal />
          </HeaderTooltip>
        )}
        <Popover usePortal={false}>
          <HeaderTooltip content="Channel Details">
            <Button icon="eye-open" minimal />
          </HeaderTooltip>
          {!_.isNil(channel) && !_.isNil(channelId) && <ChannelDetails id={channelId} name={channel} />}
        </Popover>
        <HeaderTooltip content="Chatters List">
          <Button onClick={this.toggleChatters} icon="people" minimal />
        </HeaderTooltip>
        <NavbarDivider />
      </>
    )

    if (!_.isNil(channel)) {
      this.props.setHeaderTitleComponent(<ChannelLink href={`https://twitch.tv/${channel}`}>{channel}</ChannelLink>)
    }

    this.props.setHeaderRightComponent(headerRightComponent)
  }

  /**
   * Returns the content of a tooltip when hovering a link.
   * @return The tooltip content.
   */
  private getTooltipContent = () => {
    if (!_.isNil(this.state.focusedChatter)) {
      return null
    }

    if (!_.isNil(this.logsWrapper.current)) {
      const wrapper = this.logsWrapper.current

      const nodes = wrapper.querySelectorAll(':hover')
      const node = nodes.item(nodes.length - 1)

      if (node instanceof HTMLAnchorElement) {
        const href = node.getAttribute('href')

        if (!_.isNil(href)) {
          if (PreviewRegExp.test(href)) {
            return `<div class="preview"><img src=${sanitizeUrlForPreview(href)} /></div>`
          } else {
            return null
          }
        }
      } else if (node instanceof HTMLImageElement) {
        return node.getAttribute('data-tip')
      }
    }

    return ' '
  }

  /**
   * Appends text to the input value.
   * @param text - The text to append.
   * @param [focus=true] - `true` to focus the input when done.
   */
  private appendToInputValue(text: string, focus = true) {
    this.setState(
      ({ inputValue }) => {
        const lastCharacter = inputValue.slice(-1)
        const newInputValue = `${inputValue}${lastCharacter === ' ' || inputValue.length === 0 ? '' : ' '}${text} `

        return { inputValue: newInputValue }
      },
      () => {
        requestAnimationFrame(() => {
          if (focus) {
            this.focusChatInput()
          }
        })
      }
    )
  }

  /**
   * Triggered when uploading a file fails.
   * @param error - The error.
   */
  private onUploadError = (_error: Error) => {
    Toaster.show({
      icon: 'error',
      intent: Intent.DANGER,
      message: 'Something went wrong! Please try again.',
    })

    this.setState(() => ({ isUploadingFile: false }))
  }

  /**
   * Triggered when trying to upload an invalid fails.
   */
  private onUploadInvalid = () => {
    Toaster.show({
      icon: 'error',
      intent: Intent.DANGER,
      message: 'Only images can be uploaded!',
    })

    this.setState(() => ({ isUploadingFile: false }))
  }

  /**
   * Triggered when starting to upload a file.
   */
  private onUploadStart = () => {
    this.setState(() => ({ isUploadingFile: true }))
  }

  /**
   * Triggered after a successful upload.
   * @param url - The URL of the uploaded file.
   * @param deletionUrl -  The URL to delete the uploaded file.
   */
  private onUploadSuccess = (url: string, deletionUrl: string) => {
    this.appendToInputValue(url)

    this.setState(() => ({ isUploadingFile: false }))

    const notice = new Notice(
      `Image uploaded successfully. To delete it, use <a href="${deletionUrl}" target="_blank">this link</a>.`,
      null,
      true
    )

    this.props.addLog(notice.serialize())
  }

  /**
   * Triggered when the application is focused.
   */
  private onFocusWindow = () => {
    if (this.props.autoFocusInput) {
      this.focusChatInput()
    }
  }

  /**
   * Triggered when input value is modified.
   */
  private onChangeInputValue = (value: string) => {
    let inputValue = value
    const shrug = Command.parseShrug(value)

    if (Command.isWhisperReplyCommand(value)) {
      const { lastWhisperSender } = this.props
      inputValue = `/w ${this.props.lastWhisperSender}${lastWhisperSender.length > 0 ? ' ' : ''}`
    } else if (shrug.isShrug) {
      inputValue = shrug.message
    } else if (Command.isHelpCommand(value)) {
      inputValue = ''
      this.toggleCommandsHelp()
    }

    this.setState(() => ({ inputValue }))
  }

  /**
   * Starts monitoring the viewer count.
   */
  private startMonitoringViewerCount() {
    this.monitorViewerCount()

    if (_.isNil(this.viewerCountMonitorId)) {
      // Update every 2mins.
      this.viewerCountMonitorId = window.setInterval(this.monitorViewerCount, 120000)
    }
  }

  /**
   * Stops monitoring the viewer count.
   */
  private stopMonitoringViewerCount() {
    if (!_.isNil(this.viewerCountMonitorId)) {
      window.clearInterval(this.viewerCountMonitorId)
      this.viewerCountMonitorId = undefined

      this.setState(() => ({ viewerCount: undefined }))
    }
  }

  /**
   * Monitors the viewer count.
   */
  private monitorViewerCount = async () => {
    const { roomState } = this.props
    let viewers: number

    if (!_.isNil(roomState)) {
      const channelId = this.getChannelId()

      if (!_.isNil(channelId)) {
        const { stream } = await Twitch.fetchStream(channelId)

        if (!_.isNil(stream)) {
          viewers = stream.viewers
        }
      }
    }

    this.setState(() => ({ viewerCount: viewers }))
  }

  /**
   * Scrolls to the newest log available.
   */
  private scrollToNewestLog = () => {
    if (!_.isNil(this.logsComponent.current) && !_.isNil(this.logsComponent.current.list.current)) {
      const element = document.querySelector('.ReactVirtualized__Grid')

      if (!_.isNil(element)) {
        const maxScrollTop = element.scrollHeight - element.clientHeight

        if (maxScrollTop > element.scrollTop) {
          this.logsComponent.current.list.current.scrollToPosition(maxScrollTop)
          requestAnimationFrame(this.scrollToNewestLog)
        }
      }
    }
  }

  /**
   * Toggles a UI and focus the chat input if closing it.
   * @param ui - The UI to toggle.
   */
  private toggleUI(ui: ToggleableUI) {
    const closing = this.state[ui]

    this.setState((prevState) => ({ ...prevState, [ui]: !prevState[ui] }))

    if (closing) {
      this.focusChatInput()
    }
  }

  /**
   * Toggles the chatters list.
   */
  private toggleChatters = () => {
    this.toggleUI(ToggleableUI.Chatters)
  }

  /**
   * Toggles the poll editor.
   */
  private togglePollEditor = () => {
    this.toggleUI(ToggleableUI.PollEditor)
  }

  /**
   * Toggles the logs exporter.
   */
  private toggleLogsExporter = () => {
    this.toggleUI(ToggleableUI.LogsExporter)
  }

  /**
   * Toggles the broadcaster overlay.
   */
  private toggleBroadcasterOverlay = () => {
    this.toggleUI(ToggleableUI.BroadcasterOverlay)
  }

  /**
   * Toggles the channel omnibar.
   */
  private toggleFollowOmnibar = () => {
    this.toggleUI(ToggleableUI.FollowOmnibar)
  }

  /**
   * Toggles the search.
   */
  private toggleSearch = () => {
    this.toggleUI(ToggleableUI.Search)
  }

  /**
   * Toggles the commands help.
   */
  private toggleCommandsHelp = () => {
    this.toggleUI(ToggleableUI.CommandsHelp)
  }

  /**
   * Handle a user defined action.
   * @param action - The action to execute.
   * @param [chatter=this.state.focusedChatter] - The chatter on who the action is triggered.
   */
  private handleAction = async (
    action: SerializedAction,
    chatter: Optional<SerializedChatter> = this.state.focusedChatter
  ) => {
    const { channel } = this.props

    if (_.isNil(channel) || _.isNil(chatter)) {
      return
    }

    const placeholders = {
      [ActionPlaceholder.Channel]: channel,
      [ActionPlaceholder.Username]: chatter.userName,
    }

    try {
      const text = Action.parse(action, placeholders)

      if (action.type === ActionType.Say) {
        await this.say(text)
      } else if (action.type === ActionType.Whisper && !_.isNil(action.recipient)) {
        await this.whisper(action.recipient, text)
      } else if (action.type === ActionType.Prepare) {
        this.setState(() => ({ inputValue: text }))

        this.focusChatInput()
      } else if (action.type === ActionType.Open) {
        window.open(text)
      }
    } catch {
      Toaster.show({
        icon: 'error',
        intent: Intent.DANGER,
        message: 'Something went wrong! Check your action configuration.',
      })
    }
  }

  /**
   * Focus the chat input.
   */
  private focusChatInput = () => {
    if (!_.isNil(this.input.current)) {
      this.input.current.focus()
    }
  }

  /**
   * Focuses a specific chatter.
   * @param chatter - The chatter to focus.
   */
  private focusChatter = (chatter: SerializedChatter) => {
    this.setState(() => ({ focusedChatter: this.props.chatters[chatter.id] }))
  }

  /**
   * Unfocuses any focused chatter.
   */
  private unfocusChatter = () => {
    this.setState(() => ({ focusedChatter: undefined }))

    this.focusChatInput()
  }

  /**
   * Quotes a message.
   */
  private quoteMessage = (message: SerializedMessage) => {
    this.appendToInputValue(`“${message.text}”`)
  }

  /**
   * Copy message(s) to the clipboard.
   * @param messages - The message(s) to copy.
   */
  private copyMessageToClipboard = (messages: SerializedMessage | SerializedMessage[]) => {
    this.copyToClipboard(convertMessagesToString(messages))

    const selection = window.getSelection()

    if (!_.isNil(selection) && selection.toString().trim().length === 0) {
      selection.empty()
    }
  }

  /**
   * Copies content to the clipboard.
   * @param content - The content to copy.
   */
  private copyToClipboard = (content: string) => {
    copy(content)

    Toaster.show({ message: 'Copied!', intent: Intent.SUCCESS, icon: 'clipboard', timeout: 1000 })
  }

  /**
   * Determines if the current user can moderate a specific user.
   * @param  chatter - The user to moderate.
   * @retern `true` when the user can be moderated.
   */
  private canModerate = (chatter: SerializedChatter) => {
    const { channel, isMod, loginDetails } = this.props

    const userIsBroadcaster = !_.isNil(loginDetails) && !_.isNil(channel) && loginDetails.username === channel
    const chatterIsBroadcaster = chatter.isBroadcaster
    const chatterIsSelf = chatter.isSelf
    const chatterIsMod = chatter.isMod

    return (
      (isMod && userIsBroadcaster && !chatterIsSelf) ||
      (isMod && !chatterIsSelf && !chatterIsBroadcaster && !chatterIsMod)
    )
  }

  /**
   * Returns a list of completions for a specific word.
   * @param  word - The word to auto-complete.
   * @param  excludeEmotes - `true` to ignore emotes.
   * @return The list of completions.
   */
  private getCompletions = (word: string, excludeEmotes: boolean = false) => {
    const sanitizedWord = word.toLowerCase()

    const { chatters, emotes, prioritizeUsernames } = this.props

    const usernameCompletions = _.reduce(
      chatters,
      (usernames, chatter) => {
        if (chatter.displayName.toLowerCase().startsWith(sanitizedWord)) {
          usernames.push(chatter.displayName)
        } else if (chatter.showUserName && chatter.userName.toLowerCase().startsWith(sanitizedWord)) {
          usernames.push(chatter.userName)
        }

        return usernames
      },
      [] as string[]
    )

    let emoteCompletions: string[] = []

    if (!excludeEmotes) {
      emoteCompletions = _.filter(emotes, (emote) => {
        return emote.code.toLowerCase().startsWith(sanitizedWord)
      }).map((emote) => emote.code)

      // order emotes matching the case first, then typical ordering
      emoteCompletions.sort((a: string, b: string) => {
        if (a.startsWith(word)) {
          if (b.startsWith(word)) {
            return a.localeCompare(b)
          }
          return -1
        } else if (b.startsWith(word)) {
          return 1
        }
        return a.localeCompare(b)
      })
    }

    if (prioritizeUsernames) {
      return [...usernameCompletions, ...emoteCompletions]
    }

    return [...emoteCompletions, ...usernameCompletions]
  }

  /**
   * Returns the next or previous history entry if available.
   * @param [next=true] - `true` to fetch the previous entry or `false` for the next one.
   */
  private getHistory = (previous: boolean = true) => {
    const { history, historyIndex } = this.props

    const index = historyIndex + (previous ? 1 : -1)

    let entry: string | null

    if (previous && index >= history.length) {
      entry = null
    } else if (!previous && index < 0) {
      this.props.updateHistoryIndex(-1)

      entry = null
    } else {
      this.props.updateHistoryIndex(index)

      entry = history[index]
    }

    return { entry, atStart: index < 0 }
  }

  /**
   * Returns the Twitch client instance if defined and connected.
   * @return The Twitch client or null.
   */
  private getTwitchClient() {
    if (!_.isNil(this.chatClient.current)) {
      const chatClient = this.chatClient.current as ChatClient
      const twitchClient = chatClient.client

      if (twitchClient.readyState() !== ReadyState.Open) {
        return null
      }

      return twitchClient
    }

    return null
  }

  /**
   * Manages actions that could arise when handling a command.
   * @see CommandDelegate
   */
  private onCommandHandlerAction: CommandDelegate = (
    action: CommandDelegateAction,
    arg1: Log | string,
    arg2?: number | string,
    arg3?: string
  ) => {
    if (action === CommandDelegateAction.AddLog && isLog(arg1)) {
      this.props.addLog(arg1)
    } else if (action === CommandDelegateAction.AddToHistory && _.isString(arg1)) {
      this.props.addToHistory(arg1)
    } else if (action === CommandDelegateAction.Say && _.isString(arg1)) {
      this.say(arg1)
    } else if (action === CommandDelegateAction.SayWithoutHistory && _.isString(arg1)) {
      this.say(arg1, true)
    } else if (action === CommandDelegateAction.Timeout && _.isString(arg1) && _.isNumber(arg2)) {
      this.timeout(arg1, arg2)
    } else if (action === CommandDelegateAction.Whisper && _.isString(arg1) && _.isString(arg2)) {
      this.whisper(arg1, arg2, arg3)
    }
  }

  /**
   * Retuns informations that can be used while handling a command.
   * @see CommandDelegateDataFetcher
   */
  private onCommandHandlerDataRequest: CommandDelegateDataFetcher = () => {
    return { channelId: this.getChannelId() }
  }

  /**
   * Sends a message or a whisper from the chat input.
   */
  private sendMessage = async () => {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      try {
        const message = this.state.inputValue.trim()

        this.setState(() => ({ inputValue: '' }))

        if (Command.isCommand(message)) {
          const command = new Command(message, this.onCommandHandlerAction, this.onCommandHandlerDataRequest)
          await command.handle()
        } else {
          await this.say(message)
        }
      } catch {
        //
      }
    }
  }

  /**
   * Sends a message.
   * @param message - The message to send.
   * @param ignoreHistory - Defines if the message should not be added to the
   * history.
   */
  private async say(message: string, ignoreHistory: boolean = false) {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      await client.say(channel, message)

      if (!ignoreHistory) {
        this.props.addToHistory(message)
      }
    }
  }

  /**
   * Sends a whisper.
   * @param username - The recipient.
   * @param whisper - The whisper to send.
   * @param [command] - The command used to send the whisper.
   */
  private async whisper(username: string, whisper: string, command?: string) {
    const { addWhispersToHistory, channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      const chatClient = this.chatClient.current as ChatClient
      chatClient.nextWhisperRecipient = username

      await client.whisper(username, whisper)

      if (!_.isNil(command) && addWhispersToHistory) {
        this.props.addToHistory(command)
      }
    }
  }

  /**
   * Deletes a single message.
   * @param id - The message id.
   */
  private deleteMessage = async (id: string) => {
    try {
      await this.say(`/delete ${id}`)
    } catch {
      Toaster.show({
        icon: 'error',
        intent: Intent.DANGER,
        message: 'Something went wrong! Please try again.',
      })
    }
  }

  /**
   * Timeouts a user.
   * @param username - The name of the user to timeout.
   * @param duration - The duration of the timeout in seconds.
   */
  private timeout = async (username: string, duration: number) => {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      try {
        await client.timeout(channel, username, duration)
      } catch {
        //
      }
    }
  }

  /**
   * Bans a user.
   * @param username - The name of the user to ban.
   * @param [reason] - The ban reason.
   */
  private ban = async (username: string, reason?: string) => {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      try {
        await client.ban(channel, username, reason)
      } catch {
        //
      }
    }
  }

  /**
   * Unbans a user.
   * @param username - The name of the user to unban.
   */
  private unban = async (username: string) => {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      try {
        await client.unban(channel, username)
      } catch {
        //
      }
    }
  }

  /**
   * Blocks a user.
   * @param targetId - The id of the user to block.
   */
  private block = async (targetId: string) => {
    try {
      const blockedUser = await Twitch.blockUser(targetId)

      this.props.markChatterAsBlocked(blockedUser.user._id)
    } catch {
      //
    }
  }

  /**
   * Unblocks a user.
   * @param targetId - The id of the user to unblock.
   */
  private unblock = async (targetId: string) => {
    try {
      await Twitch.unblockUser(targetId)

      this.props.markChatterAsUnblocked(targetId)
    } catch {
      //
    }
  }

  /**
   * Follows a channel.
   * @param targetId - The id of the channel to follow.
   */
  private follow = (targetId: string) => {
    try {
      Twitch.followChannel(targetId)
    } catch {
      //
    }
  }

  /**
   * Unfollows a channel.
   * @param targetId - The id of the channel to unfollow.
   */
  private unfollow = (targetId: string) => {
    try {
      Twitch.unfollowChannel(targetId)
    } catch {
      //
    }
  }

  /**
   * Prepare a whisper by setting the input to the whisper command.
   * @param username - The username to whisper.
   */
  private prepareWhisper = (username: string) => {
    this.setState(() => ({ inputValue: `/w ${username} ` }))

    this.focusChatInput()
  }

  /**
   * Clears the chat.
   */
  private clearChat = async () => {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      try {
        await client.clear(channel)
      } catch {
        //
      }
    }
  }

  /**
   * Toggles the R9K mode.
   */
  private toggleR9k = async () => {
    const { channel, roomState } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel) && !_.isNil(roomState)) {
      try {
        if (roomState.r9k) {
          await client.r9kbetaoff(channel)
        } else {
          await client.r9kbeta(channel)
        }
      } catch {
        //
      }
    }
  }

  /**
   * Toggles the slow mode.
   * @param duration - The optional duration.
   */
  private toggleSlowMode = async (duration?: SlowModeDuration) => {
    const { channel, roomState } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel) && !_.isNil(roomState)) {
      try {
        if (roomState.slowDuration === duration || (_.isNil(duration) && roomState.slow)) {
          await client.slowoff(channel)
        } else {
          // Don't use the default twitch-js value, use the default from Twitch.
          const durationWithDefault = duration || 30
          await client.slow(channel, durationWithDefault)
        }
      } catch {
        //
      }
    }
  }

  /**
   * Toggles the followers-only mode.
   */
  private toggleFollowersOnly = async () => {
    const { channel, roomState } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel) && !_.isNil(roomState)) {
      try {
        if (roomState.followersOnly) {
          await client.followersonlyoff(channel)
        } else {
          await client.followersonly(channel)
        }
      } catch {
        //
      }
    }
  }

  /**
   * Toggles the subscribers-only mode.
   */
  private toggleSubsOnly = async () => {
    const { channel, roomState } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel) && !_.isNil(roomState)) {
      try {
        if (roomState.subsOnly) {
          await client.subscribersoff(channel)
        } else {
          await client.subscribers(channel)
        }
      } catch {
        //
      }
    }
  }

  /**
   * Toggles the emote-only mode.
   */
  private toggleEmoteOnly = async () => {
    const { channel, roomState } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel) && !_.isNil(roomState)) {
      try {
        if (roomState.emoteOnly) {
          await client.emoteonlyoff(channel)
        } else {
          await client.emoteonly(channel)
        }
      } catch {
        //
      }
    }
  }

  /**
   * Unhosts a channel.
   */
  private unhost = async () => {
    const { channel } = this.props
    const client = this.getTwitchClient()

    if (!_.isNil(client) && !_.isNil(channel)) {
      try {
        await client.unhost(channel)
      } catch {
        //
      }
    }
  }

  /**
   * Clips the current stream.
   */
  private clip = async () => {
    const channelId = this.getChannelId()

    if (_.isNil(channelId)) {
      return
    }

    try {
      const response = await Twitch.createClip(channelId)

      if (response.data.length > 0) {
        window.open(response.data[0].edit_url)
      } else {
        throw new Error('Something went wrong while creating the clip!')
      }
    } catch (error) {
      if (error instanceof Error) {
        Toaster.show({
          icon: 'error',
          intent: Intent.DANGER,
          message: error.message,
        })
      }
    }
  }
}

/**
 * Component enhancer.
 */
const enhance = compose<Props, {}>(
  connect<StateProps, DispatchProps, OwnProps, ApplicationState>(
    (state) => ({
      addWhispersToHistory: getAddWhispersToHistory(state),
      allLogs: getLogs(state),
      alternateMessageBackgrounds: getAlternateMessageBackgrounds(state),
      autoFocusInput: getAutoFocusInput(state),
      channel: getChannel(state),
      chatters: getChatters(state),
      copyMessageOnDoubleClick: getCopyMessageOnDoubleClick(state),
      emotes: getEmotes(state),
      history: getHistory(state),
      historyIndex: getHistoryIndex(state),
      isAutoScrollPaused: getIsAutoScrollPaused(state),
      isMod: getIsMod(state),
      lastReadId: getLastReadId(state),
      lastWhisperSender: getLastWhisperSender(state),
      loginDetails: getLoginDetails(state),
      markNewAsUnread: getMarkNewAsUnread(state),
      prioritizeUsernames: getPrioritizeUsernames(state),
      roomState: getRoomState(state),
      shortcuts: getShortcuts(state),
      showContextMenu: getShowContextMenu(state),
      showViewerCount: getShowViewerCount(state),
      status: getStatus(state),
    }),
    {
      addLog,
      addMarker,
      addToHistory,
      markAsRead,
      markChatterAsBlocked,
      markChatterAsUnblocked,
      pauseAutoScroll,
      setChannel,
      updateHistoryIndex,
    }
  ),
  withHeader,
  HotkeysTarget
)

export default enhance(Channel)

/**
 * React Props.
 */
interface StateProps {
  addWhispersToHistory: ReturnType<typeof getAddWhispersToHistory>
  allLogs: ReturnType<typeof getLogs>
  alternateMessageBackgrounds: ReturnType<typeof getAlternateMessageBackgrounds>
  autoFocusInput: ReturnType<typeof getAutoFocusInput>
  channel: ReturnType<typeof getChannel>
  chatters: ReturnType<typeof getChatters>
  copyMessageOnDoubleClick: ReturnType<typeof getCopyMessageOnDoubleClick>
  emotes: ReturnType<typeof getEmotes>
  shortcuts: ReturnType<typeof getShortcuts>
  history: ReturnType<typeof getHistory>
  historyIndex: ReturnType<typeof getHistoryIndex>
  isAutoScrollPaused: ReturnType<typeof getIsAutoScrollPaused>
  isMod: ReturnType<typeof getIsMod>
  lastReadId: ReturnType<typeof getLastReadId>
  lastWhisperSender: ReturnType<typeof getLastWhisperSender>
  loginDetails: ReturnType<typeof getLoginDetails>
  markNewAsUnread: ReturnType<typeof getMarkNewAsUnread>
  prioritizeUsernames: ReturnType<typeof getPrioritizeUsernames>
  roomState: ReturnType<typeof getRoomState>
  showContextMenu: ReturnType<typeof getShowContextMenu>
  showViewerCount: ReturnType<typeof getShowViewerCount>
  status: ReturnType<typeof getStatus>
}

/**
 * React Props.
 */
interface DispatchProps {
  addLog: typeof addLog
  addMarker: typeof addMarker
  addToHistory: typeof addToHistory
  markAsRead: typeof markAsRead
  markChatterAsBlocked: typeof markChatterAsBlocked
  markChatterAsUnblocked: typeof markChatterAsUnblocked
  pauseAutoScroll: typeof pauseAutoScroll
  setChannel: typeof setChannel
  updateHistoryIndex: typeof updateHistoryIndex
}

/**
 * React Props.
 */
interface OwnProps extends WithHeaderProps {
  match: match<{
    channel: string
  }>
}

/**
 * React Props.
 */
type Props = StateProps & DispatchProps & OwnProps
