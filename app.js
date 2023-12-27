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

async function cancelReservation(prevDay, currentDay, name) {
  console.log('취소 DB 변경 시작');
  const prevGetItemCommand = new GetItemCommand({
    TableName: 'holydays',
    Key: {
      day: { N: String(prevDay) },
    },
  });
  const curGetItemCommand = new GetItemCommand({
    TableName: 'holydays',
    Key: {
      day: { N: String(currentDay) },
    },
  });

  const prevfindDB = await client.send(prevGetItemCommand);
  const curfindDB = await client.send(curGetItemCommand);

  if (prevfindDB.Item) {
    const prevMessage = [...prevfindDB.Item.message.SS];

    prevMessage.splice(
      prevMessage.findIndex((value) => value.includes(name)),
      1,
    );

    const prevUpdateItemCommand = new PutItemCommand({
      TableName: 'holydays',
      Item: {
        day: { N: String(prevDay) },
        message: { SS: prevMessage },
      },
    });
    const prevDeleteItemCommand = new DeleteItemCommand({
      TableName: 'holydays',
      Key: {
        day: { N: String(prevDay) },
      },
    });
    if (prevMessage.length === 0) {
      await client.send(prevDeleteItemCommand);
      console.log('이전 날짜 삭제 완료');
    } else {
      await client.send(prevUpdateItemCommand);
      console.log('이전 날짜 변경 완료');
    }
  } else {
    console.log('이전 날짜 데이터 없음');
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
      console.log('당일 날짜 삭제 완료');
    } else {
      await client.send(currentUpdateItemCommand);
      console.log('당일 날짜 변경 완료');
    }
  } else {
    console.log('당일 날짜 데이터 없음');
  }
}

async function getMsg(day) {
  const curGetItemCommand = new GetItemCommand({
    TableName: 'holydays',
    Key: {
      day: { N: String(day) },
    },
  });
  const result = await client.send(curGetItemCommand);
  return result;
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

      const curPutItemCommand = new PutItemCommand({
        TableName: 'holydays',
        Item: {
          day: { N: String(RESERVATION_DATE) },
          message: { SS: [`${name[1]}님 : ${split[1]}`] },
        },
      });
      const prevPutItemCommand = new PutItemCommand({
        TableName: 'holydays',
        Item: {
          day: { N: String(PREV_RESERVATION_DATE) },
          message: { SS: [`${name[1]}님 : ${split[1]}`] },
        },
      });

      const prevGetItemCommand = new GetItemCommand({
        TableName: 'holydays',
        Key: {
          day: { N: String(PREV_RESERVATION_DATE) },
        },
      });
      const curGetItemCommand = new GetItemCommand({
        TableName: 'holydays',
        Key: {
          day: { N: String(RESERVATION_DATE) },
        },
      });

      //취소라면
      if (isCancel) {
        console.log('취소 시작');
        await cancelReservation(PREV_RESERVATION_DATE, RESERVATION_DATE, name[1]);
        const prevMsg = await getMsg(PREV_RESERVATION_DATE);
        const curMsg = await getMsg(RESERVATION_DATE);

        //이전날짜가 오늘보다 이전이 아닐 때
        if (!(prevDate <= today)) {
          console.log('휴가 전날이 오늘보다 이전일 때 취소 시작');
          const prevReservationMessages = await app.client.chat.scheduledMessages.list({
            token: context.botToken,
            channel: payload.channel,
            latest: String(PREV_RESERVATION_DATE),
            oldest: String(PREV_RESERVATION_DATE),
          });
          if (prevReservationMessages.scheduled_messages.length !== 0) {
            await app.client.chat.deleteScheduledMessage({
              token: context.botToken,
              channel: prevReservationMessages.scheduled_messages[0].channel_id,
              scheduled_message_id: prevReservationMessages.scheduled_messages[0].id,
            });
            console.log('취소 메세지 삭제 완료');
          }

          const prev = [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '내일 휴가자 있을 것 같은 예감이 듭니다 :ghost2:',
                emoji: true,
              },
            },
          ];

          if (!prevMsg.Item) {
            console.log('취소 후 등록 할 메세지 없음');
            return;
          }
          prevMsg.Item.message.SS.forEach((value) => {
            prev.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${value}`,
              },
            });
          });

          await app.client.chat.scheduleMessage({
            token: context.botToken,
            channel: payload.channel,
            text: '내일 휴가자 있을 것 같은 예감이 듭니다',
            blocks: prev,
            post_at: PREV_RESERVATION_DATE,
          });
          console.log('취소 후 메세지 등록 완료');
        }
        console.log('휴가 당일 취소 시작');
        const currentReservationMessages = await app.client.chat.scheduledMessages.list({
          token: context.botToken,
          channel: payload.channel,
          latest: String(RESERVATION_DATE),
          oldest: String(RESERVATION_DATE),
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

        const cur = [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '오늘의 휴가자를 발견했어요!! :ghost2:',
              emoji: true,
            },
          },
        ];

        if (!curMsg.Item) {
          console.log('취소 후 등록 할 메세지 없음');
          return;
        }

        curMsg.Item.message.SS.forEach((value) => {
          cur.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${value}`,
            },
          });
        });

        await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '오늘의 휴가자를 발견했어요!!',
          blocks: cur,
          post_at: RESERVATION_DATE,
        });
        console.log('취소 후 메세지 등록 완료');
        return;
      }

      const prevFindDB = await client.send(prevGetItemCommand);
      const curFindDB = await client.send(curGetItemCommand);

      // 취소가 아닐 때 db변경
      if (!prevFindDB.Item) {
        if (!(prevDate <= today)) {
          await client.send(prevPutItemCommand);
          console.log('db에 이전 날짜 추가');
        }
      } else {
        const prevMessage = [...prevFindDB.Item.message.SS];
        prevMessage.push(`${name[1]}님 : ${split[1]}`);
        const prevUpdateItemCommand = new PutItemCommand({
          TableName: 'holydays',
          Item: {
            day: { N: String(PREV_RESERVATION_DATE) },
            message: { SS: prevMessage },
          },
        });
        if (!(prevDate <= today)) {
          console.log('db에 중복 이전 날짜 추가');
          await client.send(prevUpdateItemCommand);
        }
      }

      if (!curFindDB.Item) {
        await client.send(curPutItemCommand);
        console.log('db에 당일 날짜 추가');
      } else {
        const curMessage = [...curFindDB.Item.message.SS];
        curMessage.push(`${name[1]}님 : ${split[1]}`);
        const curUpdateItemCommand = new PutItemCommand({
          TableName: 'holydays',
          Item: {
            day: { N: String(RESERVATION_DATE) },
            message: { SS: curMessage },
          },
        });
        await client.send(curUpdateItemCommand);
        console.log('db에 중복 당일 날짜 추가');
      }

      //이전날짜가 오늘보다 이전이 아닐 때
      if (!(prevDate <= today)) {
        console.log('휴가 전날이 오늘보다 이전일 때 에약 시작');
        const prevReservationMessages = await app.client.chat.scheduledMessages.list({
          token: context.botToken,
          channel: payload.channel,
          latest: String(PREV_RESERVATION_DATE),
          oldest: String(PREV_RESERVATION_DATE),
        });

        if (prevReservationMessages.scheduled_messages.length !== 0) {
          await app.client.chat.deleteScheduledMessage({
            token: context.botToken,
            channel: prevReservationMessages.scheduled_messages[0].channel_id,
            scheduled_message_id: prevReservationMessages.scheduled_messages[0].id,
          });

          const prevMessage = [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '내일 휴가자 있을 것 같은 예감이 듭니다 :ghost2:',
                emoji: true,
              },
            },
          ];
          if (prevFindDB.Item) {
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
          prevMessage.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${name[1]}님 : ${split[1]}`,
            },
          });
          await app.client.chat.scheduleMessage({
            token: context.botToken,
            channel: payload.channel,
            text: '내일 휴가자 있을 것 같은 예감이 듭니다',
            blocks: prevMessage,
            post_at: PREV_RESERVATION_DATE,
          });
          console.log('중복 메세지 등록 완료');
        } else {
          await app.client.chat.scheduleMessage({
            token: context.botToken,
            channel: payload.channel,
            text: '내일 휴가자 있을 것 같은 예감이 듭니다',
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: '내일 휴가자 있을 것 같은 예감이 듭니다 :ghost2:',
                  emoji: true,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `${name[1]}님 : ${split[1]}`,
                },
              },
            ],
            post_at: PREV_RESERVATION_DATE,
          });
          console.log('메세지 등록 완료');
        }
      }
      console.log('휴가 당일 예약 시작');
      const curReservationMessages = await app.client.chat.scheduledMessages.list({
        token: context.botToken,
        channel: payload.channel,
        latest: String(RESERVATION_DATE),
        oldest: String(RESERVATION_DATE),
      });

      //예약메시지 있으면
      if (curReservationMessages.scheduled_messages.length !== 0) {
        await app.client.chat.deleteScheduledMessage({
          token: context.botToken,
          channel: curReservationMessages.scheduled_messages[0].channel_id,
          scheduled_message_id: curReservationMessages.scheduled_messages[0].id,
        });

        const currentMessage = [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '오늘의 휴가자를 발견했어요!! :ghost2:',
              emoji: true,
            },
          },
        ];
        if (curFindDB.Item) {
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
        currentMessage.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${name[1]}님 : ${split[1]}`,
          },
        });

        await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '오늘의 휴가자를 발견했어요!!',
          blocks: currentMessage,
          post_at: RESERVATION_DATE,
        });
        console.log('중복 메세지 등록 완료');
      } else {
        await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '오늘의 휴가자를 발견했어요!!',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '오늘의 휴가자를 발견했어요!! :ghost2:',
                emoji: true,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${name[1]}님 : ${split[1]}`,
              },
            },
          ],
          post_at: RESERVATION_DATE,
        });
        console.log('메세지 등록 완료');
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
