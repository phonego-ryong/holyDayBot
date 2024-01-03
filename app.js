const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { App, AwsLambdaReceiver, LogLevel } = require('@slack/bolt');

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const NAME_REGEX = /\[(.*?)\]/;
const DATE_REGEX = /(\d{1,2})월 (\d{1,2})일/;
const KOREA_TIME = 1000 * 60 * 60 * 9;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
  logLevel: LogLevel.DEBUG,
});

const client = new DynamoDBClient({ region: 'ap-northeast-2' });

class HolyDayManage {
  constructor(curDay, prevDay, today) {
    this.curDay = curDay;
    this.prevDay = prevDay;
    this.today = today;
    this.PREV_RESERVATION_DATE = Math.floor((this.prevDay.getTime() - KOREA_TIME) / 1000);
    this.RESERVATION_DATE = Math.floor((this.curDay.getTime() - KOREA_TIME) / 1000);
  }

  async writeDB(tableName, day, message) {
    console.log(tableName, day, message);
    const putItemCommand = new PutItemCommand({
      TableName: tableName,
      Item: {
        day: { N: String(day) },
        message: { SS: message },
      },
    });
    await client.send(putItemCommand);
  }

  async reservationDB(prevDay, currentDay, message) {
    console.log('DB 등록 시작');
    console.log('이전 날짜 DB 등록 시작');
    const prevMessage = await getPrevDB(this.PREV_RESERVATION_DATE);
    // 중복 메세지라면
    if (prevMessage.Item) {
      const tempMessage = [...prevMessage.Item.message.SS];
      tempMessage.push(message);
      if (!(this.prevDay <= this.today)) {
        await writeDB('prevHolydays', this.PREV_RESERVATION_DATE, tempMessage);
        console.log('이전 날짜 중복 메세지 등록 완료');
      }
    } else {
      if (!(this.prevDay <= this.today)) {
        await this.writeDB('prevHolydays', this.PREV_RESERVATION_DATE, [message]);
        console.log('이전 날짜 메세지 등록 완료');
      }
    }

    console.log('당일 날짜 DB 등록 시작');
    const curMessage = await getCurDB(this.RESERVATION_DATE);
    // 중복 메세지라면
    if (curMessage.Item) {
      const tempMessage = [...curMessage.Item.message.SS];
      tempMessage.push(message);
      await this.writeDB('holydays', this.RESERVATION_DATE, tempMessage);
      console.log('당일 날짜 중복 메세지 등록 완료');
    } else {
      await this.writeDB('holydays', this.RESERVATION_DATE, [message]);
      console.log('당일 날짜 메세지 등록 완료');
    }
  }

  async reservationPrevMessage(message, context, payload) {
    if (!(this.prevDay <= this.today)) {
      console.log('휴가 전날 메세지 예약 시작');
      const prevReservationMessages = await app.client.chat.scheduledMessages.list({
        token: context.botToken,
        channel: payload.channel,
        latest: String(this.PREV_RESERVATION_DATE),
        oldest: String(this.PREV_RESERVATION_DATE),
      });

      if (prevReservationMessages.scheduled_messages.length !== 0) {
        await app.client.chat.deleteScheduledMessage({
          token: context.botToken,
          channel: prevReservationMessages.scheduled_messages[0].channel_id,
          scheduled_message_id: prevReservationMessages.scheduled_messages[0].id,
        });

        const prevMessage = [];
        const prevFindDB = await getPrevDB(this.PREV_RESERVATION_DATE);
        const curFindDB = await getCurDB(this.PREV_RESERVATION_DATE);

        if (prevFindDB.Item) {
          prevMessage.push({
            type: 'header',
            text: {
              type: 'plain_text',
              text: '내일 무슨일이 일어날 것 같은 으스스한 느낌이 옵니다 :ghost2:',
              emoji: true,
            },
          });
          prevFindDB.Item.message.SS.forEach((value) => {
            prevMessage.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${value}`,
              },
            });
          });
        }

        //당일 메세지가 있으면
        if (curFindDB.Item) {
          console.log('당일 메세지 있음');
          prevMessage.push({
            type: 'divider',
          });
          prevMessage.push({
            type: 'header',
            text: {
              type: 'plain_text',
              text: '오늘의 휴가자를 발견했어요!! :ghost2:',
              emoji: true,
            },
          });
          curFindDB.Item.message.SS.forEach((value) => {
            prevMessage.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${value}`,
              },
            });
          });
        }

        await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '휴가유령이 찾아왔어요!!',
          blocks: prevMessage,
          post_at: this.PREV_RESERVATION_DATE,
        });
        console.log('중복 메세지 예약 완료');
      } else {
        await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '휴가유령이 찾아왔어요!!',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '내일 무슨일이 일어날 것 같은 으스스한 느낌이 옵니다 :ghost2:',
                emoji: true,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: message,
              },
            },
          ],
          post_at: this.PREV_RESERVATION_DATE,
        });
        console.log('메세지 등록 완료');
      }
    }
  }
  async reservationCurMessage(message, context, payload) {
    console.log('휴가 당일 메세지 예약 시작');
    const curReservationMessages = await app.client.chat.scheduledMessages.list({
      token: context.botToken,
      channel: payload.channel,
      latest: String(this.RESERVATION_DATE),
      oldest: String(this.RESERVATION_DATE),
    });
    if (curReservationMessages.scheduled_messages.length !== 0) {
      await app.client.chat.deleteScheduledMessage({
        token: context.botToken,
        channel: curReservationMessages.scheduled_messages[0].channel_id,
        scheduled_message_id: curReservationMessages.scheduled_messages[0].id,
      });

      const prevFindDB = await getPrevDB(this.RESERVATION_DATE);
      const curFindDB = await getCurDB(this.RESERVATION_DATE);

      const currentMessage = [];

      if (prevFindDB.Item) {
        currentMessage.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '내일 무슨일이 일어날 것 같은 으스스한 느낌이 옵니다 :ghost2:',
            emoji: true,
          },
        });
        prevFindDB.Item.message.SS.forEach((value) => {
          currentMessage.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${value}`,
            },
          });
        });
        currentMessage.push({
          type: 'divider',
        });
      }

      if (curFindDB.Item) {
        currentMessage.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '오늘 휴가자들이 나타났어요!! :ghost2:',
            emoji: true,
          },
        });
        curFindDB.Item.message.SS.forEach((value) => {
          currentMessage.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${value}`,
            },
          });
        });
      }

      await app.client.chat.scheduleMessage({
        token: context.botToken,
        channel: payload.channel,
        text: '휴가유령이 찾아왔어요!!',
        blocks: currentMessage,
        post_at: this.RESERVATION_DATE,
      });
      console.log('중복 메세지 등록 완료');
    } else {
      await app.client.chat.scheduleMessage({
        token: context.botToken,
        channel: payload.channel,
        text: '휴가유령이 찾아왔어요!!',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '오늘 휴가자들이 나타났어요!! :ghost2:',
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message,
            },
          },
        ],
        post_at: this.RESERVATION_DATE,
      });
      console.log('메세지 등록 완료');
    }
  }

  async reReservationMessage(context, payload) {
    //이전날짜가 오늘보다 이전이 아닐 때
    if (!(this.prevDay <= this.today)) {
      const prevMsg = await getPrevDB(this.PREV_RESERVATION_DATE);
      const curMsg = await getCurDB(this.PREV_RESERVATION_DATE);

      console.log('휴가 전날이 오늘보다 이전일 때 취소 시작');
      const prevReservationMessages = await app.client.chat.scheduledMessages.list({
        token: context.botToken,
        channel: payload.channel,
        latest: String(this.PREV_RESERVATION_DATE),
        oldest: String(this.PREV_RESERVATION_DATE),
      });
      if (prevReservationMessages.scheduled_messages.length !== 0) {
        await app.client.chat.deleteScheduledMessage({
          token: context.botToken,
          channel: prevReservationMessages.scheduled_messages[0].channel_id,
          scheduled_message_id: prevReservationMessages.scheduled_messages[0].id,
        });
        console.log('취소 메세지 삭제 완료');
      }

      const message = [];

      if (prevMsg.Item) {
        message.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '내일 무슨일이 일어날 것 같은 으스스한 느낌이 옵니다 :ghost2:',
            emoji: true,
          },
        });
        prevMsg.Item.message.SS.forEach((value) => {
          message.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${value}`,
            },
          });
        });
        message.push({
          type: 'divider',
        });
      }

      if (curMsg.Item) {
        message.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: '오늘 휴가자들이 나타났어요!! :ghost2:',
            emoji: true,
          },
        });
        curMsg.Item.message.SS.forEach((value) => {
          message.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${value}`,
            },
          });
        });
      }

      if (message.length === 0) {
        console.log('취소 후 등록 할 메세지 없음');
        return;
      }

      await app.client.chat.scheduleMessage({
        token: context.botToken,
        channel: payload.channel,
        text: '휴가유령이 찾아왔어요!!',
        blocks: message,
        post_at: this.PREV_RESERVATION_DATE,
      });
      console.log('취소 후 메세지 등록 완료');
    }

    console.log('휴가 당일 취소 시작');
    const prevMsg = await getPrevDB(this.RESERVATION_DATE);
    const curMsg = await getCurDB(this.RESERVATION_DATE);

    const currentReservationMessages = await app.client.chat.scheduledMessages.list({
      token: context.botToken,
      channel: payload.channel,
      latest: String(this.RESERVATION_DATE),
      oldest: String(this.RESERVATION_DATE),
    });
    //예약 메세지가 있다면 삭제
    if (currentReservationMessages.scheduled_messages.length !== 0) {
      await app.client.chat.deleteScheduledMessage({
        token: context.botToken,
        channel: currentReservationMessages.scheduled_messages[0].channel_id,
        scheduled_message_id: currentReservationMessages.scheduled_messages[0].id,
      });
      console.log('취소 메세지 삭제 완료');
    }

    const message = [];

    if (prevMsg.Item) {
      message.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: '내일 무슨일이 일어날 것 같은 으스스한 느낌이 옵니다 :ghost2:',
          emoji: true,
        },
      });
      prevMsg.Item.message.SS.forEach((value) => {
        message.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${value}`,
          },
        });
      });
      message.push({
        type: 'divider',
      });
    }

    if (curMsg.Item) {
      message.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: '오늘 휴가자들이 나타났어요!! :ghost2:',
          emoji: true,
        },
      });
      curMsg.Item.message.SS.forEach((value) => {
        message.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${value}`,
          },
        });
      });
    }

    if (message.length === 0) {
      console.log('예약 메세지가 없음');
      return;
    }

    await app.client.chat.scheduleMessage({
      token: context.botToken,
      channel: payload.channel,
      text: '휴가유령이 찾아왔어요!!',
      blocks: message,
      post_at: this.RESERVATION_DATE,
    });
    console.log('취소 후 메세지 등록 완료');
  }
}

async function cancelReservation(prevDay, currentDay, name) {
  console.log('취소 DB 변경 시작');
  const prevfindDB = await getPrevDB(prevDay);
  const curfindDB = await getCurDB(currentDay);

  if (prevfindDB.Item) {
    const prevMessage = [...prevfindDB.Item.message.SS];
    prevMessage.splice(
      prevMessage.findIndex((value) => value.includes(name)),
      1,
    );

    const prevUpdateItemCommand = new PutItemCommand({
      TableName: 'prevHolydays',
      Item: {
        day: { N: String(prevDay) },
        message: { SS: prevMessage },
      },
    });

    const prevDeleteItemCommand = new DeleteItemCommand({
      TableName: 'prevHolydays',
      Key: {
        day: { N: String(prevDay) },
      },
    });

    if (prevMessage.length === 0) {
      await client.send(prevDeleteItemCommand);
      console.log('이전 날짜 DB 삭제 완료');
    } else {
      await client.send(prevUpdateItemCommand);
      console.log('이전 날짜 DB 변경 완료');
    }
  } else {
    console.log('이전 날짜 DB 데이터 없음');
  }

  if (curfindDB.Item) {
    const currentMessage = [...curfindDB.Item.message.SS];
    currentMessage.splice(
      currentMessage.findIndex((value) => value.includes(name)),
      1,
    );
    const currentUpdateItemCommand = new PutItemCommand({
      TableName: 'holydays',
      Item: {
        day: { N: String(currentDay) },
        message: { SS: currentMessage },
      },
    });

    const curDeleteItemCommand = new DeleteItemCommand({
      TableName: 'holydays',
      Key: {
        day: { N: String(currentDay) },
      },
    });
    if (currentMessage.length === 0) {
      await client.send(curDeleteItemCommand);
      console.log('당일 날짜 DB 삭제 완료');
    } else {
      await client.send(currentUpdateItemCommand);
      console.log('당일 날짜 DB 변경 완료');
    }
  } else {
    console.log('당일 날짜 DB  데이터 없음');
  }
}

async function getPrevDB(day) {
  const prevGetItemCommand = new GetItemCommand({
    TableName: 'prevHolydays',
    Key: {
      day: { N: String(day) },
    },
  });
  const prevfindDB = await client.send(prevGetItemCommand);
  return prevfindDB;
}
async function getCurDB(day) {
  const curGetItemCommand = new GetItemCommand({
    TableName: 'holydays',
    Key: {
      day: { N: String(day) },
    },
  });
  const curfindDB = await client.send(curGetItemCommand);
  return curfindDB;
}

app.event('message', async ({ ack, say, payload, context }) => {
  try {
    const isFlexBot = payload.user === 'U052HV3FKL5';
    if (isFlexBot) {
      const split = payload.text.split('-');
      if (split.length !== 2) return;

      const name = split[0].match(NAME_REGEX, '');
      const isCancel = split[1].includes('취소');
      const matched = split[1].match(DATE_REGEX);
      const date = { month: matched[1], date: matched[2] };

      const today = new Date();
      today.setHours(8, 0, 0, 0);

      const vacationStartDate = new Date(
        today.getFullYear(),
        Number(date.month) - 1,
        Number(date.date),
        8,
        0,
        0,
      );
      const prevDate = new Date(
        today.getFullYear(),
        Number(date.month) - 1,
        Number(date.date) - 1,
        8,
        0,
        0,
      );
      const PREV_RESERVATION_DATE = Math.floor((prevDate.getTime() - KOREA_TIME) / 1000);
      const RESERVATION_DATE = Math.floor((vacationStartDate.getTime() - KOREA_TIME) / 1000);
      const holyDayManage = new HolyDayManage(vacationStartDate, prevDate, today);
      //취소라면
      if (isCancel) {
        console.log('취소 시작');
        await cancelReservation(PREV_RESERVATION_DATE, RESERVATION_DATE, name[1]);
        await holyDayManage.reReservationMessage(context, payload);
        return;
      } else {
        console.log('취소가 아닐 때');
        await holyDayManage.reservationDB(
          PREV_RESERVATION_DATE,
          RESERVATION_DATE,
          `${name[1]}님 : ${split[1]}`,
        );
        await holyDayManage.reservationPrevMessage(`${name[1]}님 : ${split[1]}`, context, payload);
        await holyDayManage.reservationCurMessage(`${name[1]}님 : ${split[1]}`, context, payload);
      }
    }
  } catch (error) {
    console.log('catch error');
    console.log(error);
  }
});

module.exports.handler = async (event, context, callback) => {
  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};
