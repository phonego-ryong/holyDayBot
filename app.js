import { App, AwsLambdaReceiver } from '@slack/bolt';
class MessageBox {
  constructor() {
    this.messages = {};
  }

  setMessage(time, name, value) {
    if (time in this.messages) {
      this.messages[time].push({
        name,
        date: value,
      });
    } else {
      this.messages[time] = [{ name, date: value }];
    }
    this.deletePrevData();
  }

  getMessage(RESERVATION_DATE) {
    return this.messages[RESERVATION_DATE];
  }

  deletePrevData() {
    setTimeout(() => {
      const today = new Date();
      const KOREA_TIME = 1000 * 60 * 60 * 9;
      let keysToRemove = Object.keys(this.messages).filter((key) =>
        Math.floor((today.getTime() - KOREA_TIME) / 1000),
      );
      keysToRemove.forEach((key) => delete this.messages[key]);
    });
  }
}

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
const msgBox = new MessageBox();

const NAME_REGEX = /\[([^\]]+)\]/;
const DATE_REGEX = /(\d{1,2})월 (\d{1,2})일/g;
const KOREA_TIME = 1000 * 60 * 60 * 9;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
});

// All the room in the world for your code
app.event('message', async ({ ack, say, payload, context }) => {
  const vacations = [];
  let vacationStartDate;

  try {
    const isFlexBot = payload.user === 'U052HV3FKL5';
    if (!isFlexBot) {
      const nameIter = payload.text.match(NAME_REGEX);
      const name = nameIter[1];
      let temp;

      while ((temp = DATE_REGEX.exec(payload.text)) !== null) {
        const month = parseInt(temp[1]);
        const date = parseInt(temp[2]);
        vacations.push({ month, date });
      }

      const today = new Date();
      vacationStartDate = new Date(
        today.getFullYear(),
        vacations[0].month - 1,
        vacations[0].date,
        15,
        30,
        0,
      );

      const RESERVATION_DATE = Math.floor((vacationStartDate.getTime() - KOREA_TIME) / 1000);

      msgBox.setMessage(String(RESERVATION_DATE), name, vacations);

      const reservationMessages = await app.client.chat.scheduledMessages.list({
        token: context.botToken,
        latest: (vacationStartDate.getTime() - KOREA_TIME) / 1000,
      });

      if (reservationMessages.scheduled_messages.length !== 0) {
        console.log(reservationMessages);
        await app.client.chat.deleteScheduledMessage({
          token: context.botToken,
          channel: payload.channel,
          scheduled_message_id: reservationMessages.scheduled_messages[0].id,
        });

        const block = [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '오늘부터 자유를 찾아 떠나는 사람 명단 :ghost:',
              emoji: true,
            },
          },
        ];

        msgBox.getMessage(RESERVATION_DATE).forEach((value) => {
          block.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${value.name} : ${value.date[0].month}월 ${value.date[0].date}일 ~  ${value.date[1].month}월 ${value.date[1].date}일`,
            },
          });
        });

        const result = await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '오늘의 탈주자 명단 보고합니다',
          blocks: block,
          post_at: RESERVATION_DATE,
        });
        console.log(result, '수정 완료');
      } else if (reservationMessages.scheduled_messages.length === 0) {
        await app.client.chat.scheduleMessage({
          token: context.botToken,
          channel: payload.channel,
          text: '오늘의 탈주자 명단 보고합니다',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '오늘부터 자유를 찾아 떠나는 사람 명단 :ghost:',
                emoji: true,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${name} : ${vacations[0].month}월 ${vacations[0].date}일 ~ ${vacations[1].month}월 ${vacations[1].date}일`,
              },
            },
          ],
          post_at: RESERVATION_DATE,
        });
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
