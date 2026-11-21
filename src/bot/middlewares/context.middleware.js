export function createContextMiddleware({ userRepo, chatRepo, logger = null }) {
  return async (ctx, next) => {
    try {
      if (ctx.from && !ctx.from.is_bot) {
        userRepo.upsert({
          telegramId: ctx.from.id,
          username: ctx.from.username || null,
          firstName: ctx.from.first_name || null,
          lastName: ctx.from.last_name || null
        });
      }

      if (ctx.chat) {
        const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
        const contextType = isGroup ? 'group' : ctx.chat.type === 'private' ? 'private' : null;

        if (isGroup) {
          chatRepo.upsert({
            telegramId: ctx.chat.id,
            type: ctx.chat.type,
            title: ctx.chat.title || null,
            isActive: true
          });

          if (ctx.from && !ctx.from.is_bot) {
            chatRepo.recordKnownUser({
              chatTelegramId: ctx.chat.id,
              userTelegramId: ctx.from.id,
              username: ctx.from.username || null,
              firstName: ctx.from.first_name || 'Пользователь',
              lastName: ctx.from.last_name || null
            });
          }
        }

        if (contextType && ctx.from) {
          ctx.appContext = {
            contextType,
            contextId: ctx.chat.id,
            userId: ctx.from.id,
            sessionKey: `${contextType}:${ctx.chat.id}:${ctx.from.id}`
          };
        }
      }
    } catch (err) {
      logger?.error('Ошибка в contextMiddleware', err);
    }

    return next();
  };
}
