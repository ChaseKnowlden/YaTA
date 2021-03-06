import linkifyHtml from 'linkifyjs/html'
import { nanoid } from 'nanoid'

import Event from 'constants/event'
import LogType from 'constants/logType'
import { escape } from 'utils/html'

/**
 * Notice class.
 */
export default class Notice implements Serializable<SerializedNotice> {
  /**
   * Creates a new notice from a charity user notice.
   * @param  tags - The notice tags.
   * @return The new notice.
   */
  public static fromCharity(tags: Record<string, string>) {
    const hashtag = tags['msg-param-charity-hashtag']
    const link = tags['msg-param-charity-learn-more']
    const total = parseInt(tags['msg-param-total'], 10)
    const name = tags['msg-param-charity-name'].replace('\\s', ' ')

    const totalFormatter = new Intl.NumberFormat('en-US', {
      currency: 'USD',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
      style: 'currency',
    })

    const message = `${totalFormatter.format(
      total
    )} raised for ${name} so far! Cheer with the <strong>${hashtag}</strong> hashtag or <a href="${link}" target="_blank">get more details</a>.`

    return new Notice(message, Event.UserNotices, true)
  }

  private id: string

  /**
   * Creates a new notice.
   * @class
   * @param message - The received message.
   * @param event - The associated event if any.
   * @param linkify - Defines if the notice can include links or not.
   */
  constructor(private message: string, private event: Event | null = null, private linkify = false) {
    this.id = nanoid()
  }

  /**
   * Serializes a notice.
   * @return The serialized notice.
   */
  public serialize() {
    return {
      event: this.event,
      id: this.id,
      linkify: this.linkify,
      message: this.linkify ? linkifyHtml(this.message) : escape(this.message),
      type: LogType.Notice,
    }
  }
}

/**
 * Serialized notice.
 */
export type SerializedNotice = {
  id: string
  event: Event | null
  linkify: boolean
  message: string
  type: LogType
}
