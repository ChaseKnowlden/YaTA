import { Tab, Tabs } from '@blueprintjs/core'
import * as _ from 'lodash'
import * as pluralize from 'pluralize'
import * as React from 'react'
import styled from 'styled-components'

import BroadcasterListRow, { Row } from 'Components/BroadcasterListRow'
import BroadcasterSection from 'Components/BroadcasterSection'
import NonIdealState from 'Components/NonIdealState'
import Twitch, { ClipPeriod, RawChannel } from 'Libs/Twitch'
import { color } from 'Utils/styled'

/**
 * Wrapper component.
 */
const Wrapper = styled.div`
  background-color: ${color('broadcaster.background')};
  border: 1px solid ${color('broadcaster.border')};
  height: 247px;
  overflow-y: auto;
`

/**
 * EmptyWrapper component.
 */
const EmptyWrapper = styled(Wrapper)`
  & > div > div {
    margin-top: 0;
  }
`

/**
 * Available lists.
 */
enum List {
  Clips = 'Recent Clips',
  Hosts = 'Hosts',
}

/**
 * React State.
 */
const initialState = {
  didFail: false,
  ready: false,
  [List.Clips]: [] as Row[],
  [List.Hosts]: [] as Row[],
}
type State = Readonly<typeof initialState>

/**
 * BroadcasterLists Component.
 */
export default class BroadcasterLists extends React.Component<Props, State> {
  public state: State = initialState

  /**
   * Lifecycle: componentDidMount.
   */
  public async componentDidMount() {
    try {
      const { channel, channelId } = this.props

      if (_.isNil(channel) || _.isNil(channelId)) {
        throw new Error('Missing channel informations.')
      }

      const response = await Promise.all([
        Twitch.fetchHosts(channelId),
        Twitch.fetchTopClips(channel.name, ClipPeriod.Day, 25),
      ])

      const [{ hosts }, { clips }] = response

      const clipRows = _.map(clips, (clip) => ({
        id: clip.slug,
        meta: `${clip.views.toLocaleString()} ${pluralize('views', clip.views)} - ${clip.curator.display_name}`,
        text: clip.title,
        thumbnail: clip.thumbnails.tiny,
        url: clip.url,
      }))
      const hostRows = _.map(hosts, (host) => ({
        id: host.host_id,
        text: host.host_display_name,
        url: `https://twitch.tv/${host.host_login}`,
      }))

      this.setState(() => ({ didFail: false, ready: true, [List.Clips]: clipRows, [List.Hosts]: hostRows }))
    } catch (error) {
      this.setState(() => ({ didFail: true, ready: true }))
    }
  }

  /**
   * Renders the component.
   * @return Element to render.
   */
  public render() {
    const { ready } = this.state

    return (
      <BroadcasterSection title="Miscellaneous" ready={ready}>
        <Tabs id="lists">
          {_.map(List, (list) => (
            <Tab key={list} id={`lists-${list}`} title={list} panel={this.renderList(list)} />
          ))}
        </Tabs>
      </BroadcasterSection>
    )
  }

  /**
   * Renders a specific list.
   * @return Element to render.
   */
  private renderList(list: List) {
    const rows = this.state[list]

    if (rows.length === 0) {
      return (
        <EmptyWrapper>
          <NonIdealState small title={`No ${list.toLowerCase()} yet!`} />
        </EmptyWrapper>
      )
    }

    return (
      <Wrapper>
        {_.map(rows, (row) => (
          <BroadcasterListRow key={row.id} row={row} />
        ))}
      </Wrapper>
    )
  }
}

/**
 * React Props.
 */
type Props = {
  channel: RawChannel
  channelId: string
}