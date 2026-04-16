import { Bot, InlineKeyboard, Keyboard, session, type Context, type SessionFlavor } from 'grammy';

import type { AppConfig } from '../config/load-config.js';
import {
  countActiveSubscriptionsForUser,
  deactivateSubscription,
  getSubscriptionById,
  getVaultById,
  listAvailableChains,
  listSubscriptions,
  searchVaults,
  upsertSubscription,
  updateSubscriptionThreshold,
  type MonitorType,
  type SubscriptionRecord,
  type VaultRecord,
} from '../db/repositories.js';
import type { SqliteDb } from '../db/sqlite.js';
import { formatRawAmount, parseHumanAmountToRaw } from './amounts.js';

type SubscriptionDraft = {
  chain?: string;
  query?: string;
  page: number;
  vaultId?: string;
  monitorType?: MonitorType;
};

type BotSession = {
  draft: SubscriptionDraft;
  awaiting:
    | { type: 'search' }
    | { type: 'threshold' }
    | { type: 'edit-threshold'; subscriptionId: number }
    | null;
};

type BotContext = Context & SessionFlavor<BotSession>;

const PAGE_SIZE = 10;
const MAIN_BUTTON_SUBSCRIBE = '➕ Add subscription';
const MAIN_BUTTON_SUBSCRIPTIONS = '📋 My subscriptions';
const MAIN_BUTTON_ABOUT = 'ℹ️ About';
const CANCEL_CALLBACK = 'flow:cancel';

function initialSession(): BotSession {
  return {
    draft: {
      page: 0,
    },
    awaiting: null,
  };
}

function resetDraft(ctx: BotContext): void {
  ctx.session.draft = { page: 0 };
  ctx.session.awaiting = null;
}

function requireChatAndUser(ctx: BotContext): { userId: number; chatId: number } | null {
  if (!ctx.from || !ctx.chat) {
    return null;
  }

  return {
    userId: ctx.from.id,
    chatId: ctx.chat.id,
  };
}

function monitorLabel(type: MonitorType): string {
  return type === 'deposits' ? 'Deposits' : 'Liquidity';
}

function formatVaultLabel(vault: VaultRecord): string {
  const name = vault.name || vault.contract || vault.vault_id;
  const symbol = vault.token_symbol ? ` · ${vault.token_symbol}` : '';
  const chain = vault.chain ? ` · ${vault.chain}` : '';
  return `${name} (${vault.version.toUpperCase()})${symbol}${chain}`;
}

function encodeValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeValue(value: string): string {
  return decodeURIComponent(value);
}

function buildVaultSearchKeyboard(
  chain: string,
  query: string,
  page: number,
  vaults: VaultRecord[],
  total: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const vault of vaults) {
    const text = `${vault.name || vault.contract || vault.vault_id} · ${vault.token_symbol || '?'} · ${vault.version.toUpperCase()}`;
    keyboard.text(text.slice(0, 60), `sub:vault:${vault.vault_id}`).row();
  }

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  if (page > 0) {
    keyboard.text('⬅️ Prev', `sub:page:${encodeValue(chain)}:${encodeValue(query)}:${page - 1}`);
  }
  if (page < maxPage) {
    keyboard.text('Next ➡️', `sub:page:${encodeValue(chain)}:${encodeValue(query)}:${page + 1}`);
  }
  if (page > 0 || page < maxPage) {
    keyboard.row();
  }

  return keyboard
    .text('✏️ Change search', 'sub:search_again')
    .text('🔙 Chains', 'sub:begin')
    .row()
    .text('❌ Cancel', CANCEL_CALLBACK);
}

function buildMainKeyboard(): Keyboard {
  return new Keyboard()
    .text(MAIN_BUTTON_SUBSCRIBE)
    .text(MAIN_BUTTON_SUBSCRIPTIONS)
    .row()
    .text(MAIN_BUTTON_ABOUT)
    .resized()
    .persistent();
}

function buildPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Cancel', CANCEL_CALLBACK);
}

function buildMonitorTypeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Deposits', 'sub:monitor:deposits')
    .text('Liquidity', 'sub:monitor:liquidity')
    .row()
    .text('❌ Cancel', CANCEL_CALLBACK);
}

function formatSubscription(subscription: SubscriptionRecord): string {
  const target = subscription.vault_name || subscription.vault_contract || subscription.vault_id;
  const threshold = formatRawAmount(
    subscription.threshold_amount,
    subscription.decimals,
    subscription.token_symbol,
  );

  return [
    `${target}`,
    `${subscription.vault_chain || 'Unknown chain'} · ${subscription.version.toUpperCase()}`,
    `Monitor: ${monitorLabel(subscription.monitor_type)}`,
    `Threshold: ${threshold}`,
  ].join('\n');
}

function buildSubscriptionListKeyboard(subscriptions: SubscriptionRecord[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const subscription of subscriptions) {
    const title = `${subscription.vault_name || subscription.vault_contract || subscription.vault_id} · ${monitorLabel(subscription.monitor_type)}`;
    keyboard.text(title.slice(0, 60), `subs:view:${subscription.id}`).row();
  }

  return keyboard.text('🏠 Main menu', 'menu:main');
}

function buildSubscriptionActionsKeyboard(subscriptionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✏️ Edit threshold', `subs:edit:${subscriptionId}`)
    .row()
    .text('🗑 Remove', `subs:remove:${subscriptionId}`)
    .row()
    .text('🔙 Back to subscriptions', 'subs:list')
    .row()
    .text('🏠 Main menu', 'menu:main');
}

async function renderVaultSearchResults(ctx: BotContext, db: SqliteDb): Promise<void> {
  const { chain, query = '', page } = ctx.session.draft;

  if (!chain || query.trim().length === 0) {
    await ctx.reply('Enter a search string first.');
    return;
  }

  const result = searchVaults(db, {
    chain,
    query,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  if (result.total === 0) {
    await ctx.reply(`No vaults found on ${chain} for “${query}”. Try another search string.`);
    return;
  }

  const maxPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, maxPage);
  if (currentPage !== page) {
    ctx.session.draft.page = currentPage;
  }

  const pageResult = searchVaults(db, {
    chain,
    query,
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
  });

  await ctx.reply(
    `Select a vault on ${chain} for “${query}”\nPage ${currentPage + 1}/${maxPage + 1} · ${pageResult.total} result(s)`,
    {
      reply_markup: buildVaultSearchKeyboard(chain, query, currentPage, pageResult.items, pageResult.total),
    },
  );
}

async function showMainMenu(ctx: BotContext, message = 'Choose an action:'): Promise<void> {
  await ctx.reply(message, {
    reply_markup: buildMainKeyboard(),
  });
}

async function showAbout(ctx: BotContext): Promise<void> {
  await ctx.reply(
    [
      'About',
      'GitHub: https://github.com/ratik/morpho-tg-watcher-node',
      'Author: Sergey Ratiashvili <@nnnooo1111>',
    ].join('\n'),
    {
      reply_markup: buildMainKeyboard(),
    },
  );
}

async function promptForSearch(ctx: BotContext, chain: string): Promise<void> {
  ctx.session.awaiting = { type: 'search' };
  await ctx.reply(`Selected ${chain}. Now send a search string for name, symbol, token, or address.`, {
    reply_markup: buildPromptKeyboard(),
  });
}

async function startSubscriptionFlow(ctx: BotContext, db: SqliteDb): Promise<void> {
  resetDraft(ctx);
  const chains = listAvailableChains(db);

  if (chains.length === 0) {
    await ctx.reply('Vault registry is empty right now. Please try again in a moment.', {
      reply_markup: buildMainKeyboard(),
    });
    return;
  }

  const keyboard = chains.reduce((acc, chain) => {
    acc.text(chain, `sub:chain:${encodeValue(chain)}`).row();
    return acc;
  }, new InlineKeyboard());

  keyboard.text('❌ Cancel', CANCEL_CALLBACK);

  await ctx.reply('Choose a chain:', { reply_markup: keyboard });
}

async function renderSubscriptions(ctx: BotContext, db: SqliteDb): Promise<void> {
  const identity = requireChatAndUser(ctx);
  if (!identity) {
    return;
  }

  const subscriptions = listSubscriptions(db, identity);
  if (subscriptions.length === 0) {
    await ctx.reply('You have no active subscriptions.', {
      reply_markup: buildMainKeyboard(),
    });
    return;
  }

  const lines = subscriptions.map((subscription) => formatSubscription(subscription)).join('\n\n');
  await ctx.reply(lines, {
    reply_markup: buildSubscriptionListKeyboard(subscriptions),
  });
}

export function createTelegramBot(db: SqliteDb, config: AppConfig): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.telegram.token);

  bot.use(session({ initial: initialSession }));

  bot.command('start', async (ctx) => {
    resetDraft(ctx);
    await showMainMenu(
      ctx,
      [
        'Morpho watcher bot ready.',
        '',
        'Flow:',
        '1. choose chain',
        '2. enter search string',
        '3. pick vault from paginated results',
        '4. choose deposits or liquidity',
        '5. enter threshold amount',
      ].join('\n'),
    );
  });

  bot.callbackQuery('sub:begin', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSubscriptionFlow(ctx, db);
  });

  bot.callbackQuery(/^sub:chain:(.+)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chainMatch = ctx.match[1];
    if (!chainMatch) {
      return;
    }

    const chain = decodeValue(chainMatch);
    ctx.session.draft = { chain, page: 0 };
    await promptForSearch(ctx, chain);
  });

  bot.callbackQuery('sub:search_again', async (ctx) => {
    await ctx.answerCallbackQuery();
    const chain = ctx.session.draft.chain;
    if (!chain) {
      await startSubscriptionFlow(ctx, db);
      return;
    }

    ctx.session.draft.page = 0;
    await promptForSearch(ctx, chain);
  });

  bot.callbackQuery(/^sub:page:(.+?):(.+?):(\d+)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chainMatch = ctx.match[1];
    const queryMatch = ctx.match[2];
    const pageMatch = ctx.match[3];
    if (!chainMatch || !queryMatch || !pageMatch) {
      return;
    }

    ctx.session.draft.chain = decodeValue(chainMatch);
    ctx.session.draft.query = decodeValue(queryMatch);
    ctx.session.draft.page = Number(pageMatch);
    await renderVaultSearchResults(ctx, db);
  });

  bot.callbackQuery(/^sub:vault:(.+)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const vaultId = ctx.match[1];
    if (!vaultId) {
      return;
    }

    const vault = getVaultById(db, vaultId);

    if (!vault) {
      await ctx.reply('Vault not found. Please start /subscribe again.');
      resetDraft(ctx);
      return;
    }

    ctx.session.draft.vaultId = vaultId;
    ctx.session.awaiting = null;
    await ctx.reply(`Selected:\n${formatVaultLabel(vault)}\n\nChoose monitor type:`, {
      reply_markup: buildMonitorTypeKeyboard(),
    });
  });

  bot.callbackQuery(/^sub:monitor:(deposits|liquidity)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const monitorType = ctx.match[1] as MonitorType;
    const vaultId = ctx.session.draft.vaultId;

    if (!vaultId) {
      await ctx.reply('No vault selected. Use /subscribe again.');
      resetDraft(ctx);
      return;
    }

    const vault = getVaultById(db, vaultId);
    if (!vault) {
      await ctx.reply('Vault not found. Use /subscribe again.');
      resetDraft(ctx);
      return;
    }

    ctx.session.draft.monitorType = monitorType;
    ctx.session.awaiting = { type: 'threshold' };
    await ctx.reply(
      `Selected ${monitorLabel(monitorType)} for ${formatVaultLabel(vault)}.\nEnter threshold in human units${vault.token_symbol ? ` (${vault.token_symbol})` : ''}.`,
      { reply_markup: buildPromptKeyboard() },
    );
  });

  bot.callbackQuery(CANCEL_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery('Cancelled');
    resetDraft(ctx);
    await showMainMenu(ctx);
  });

  bot.callbackQuery('menu:main', async (ctx) => {
    await ctx.answerCallbackQuery();
    resetDraft(ctx);
    await showMainMenu(ctx);
  });

  bot.callbackQuery('subs:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderSubscriptions(ctx, db);
  });

  bot.callbackQuery(/^subs:view:(\d+)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const identity = requireChatAndUser(ctx);
    if (!identity) {
      return;
    }

    const subscription = getSubscriptionById(db, {
      id: Number(ctx.match[1]),
      ...identity,
    });

    if (!subscription) {
      await ctx.reply('Subscription not found.');
      return;
    }

    await ctx.reply(formatSubscription(subscription), {
      reply_markup: buildSubscriptionActionsKeyboard(subscription.id),
    });
  });

  bot.callbackQuery(/^subs:edit:(\d+)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const identity = requireChatAndUser(ctx);
    if (!identity) {
      return;
    }

    const subscription = getSubscriptionById(db, {
      id: Number(ctx.match[1]),
      ...identity,
    });

    if (!subscription) {
      await ctx.reply('Subscription not found.');
      return;
    }

    ctx.session.awaiting = { type: 'edit-threshold', subscriptionId: subscription.id };
    await ctx.reply(
      `Enter new threshold for ${subscription.vault_name || subscription.vault_contract || subscription.vault_id}.\nCurrent: ${formatRawAmount(subscription.threshold_amount, subscription.decimals, subscription.token_symbol)}`,
      { reply_markup: buildPromptKeyboard() },
    );
  });

  bot.callbackQuery(/^subs:remove:(\d+)$/i, async (ctx) => {
    await ctx.answerCallbackQuery();
    const identity = requireChatAndUser(ctx);
    if (!identity) {
      return;
    }

    const removed = deactivateSubscription(db, {
      id: Number(ctx.match[1]),
      ...identity,
    });

    resetDraft(ctx);
    await showMainMenu(ctx, removed ? 'Subscription removed.' : 'Subscription not found.');
  });

  bot.on('message:text', async (ctx) => {
    const identity = requireChatAndUser(ctx);
    if (!identity) {
      return;
    }

    const messageText = ctx.message.text.trim();

    if (messageText === MAIN_BUTTON_SUBSCRIBE) {
      await startSubscriptionFlow(ctx, db);
      return;
    }

    if (messageText === MAIN_BUTTON_SUBSCRIPTIONS) {
      ctx.session.awaiting = null;
      await renderSubscriptions(ctx, db);
      return;
    }

    if (messageText === MAIN_BUTTON_ABOUT) {
      resetDraft(ctx);
      await showAbout(ctx);
      return;
    }

    if (messageText.startsWith('/')) {
      await showMainMenu(ctx);
      return;
    }

    if (ctx.session.awaiting?.type === 'search') {
      ctx.session.draft.query = messageText;
      ctx.session.draft.page = 0;
      await renderVaultSearchResults(ctx, db);
      return;
    }

    if (ctx.session.awaiting?.type === 'threshold') {
      const vaultId = ctx.session.draft.vaultId;
      const monitorType = ctx.session.draft.monitorType;

      if (!vaultId || !monitorType) {
        await ctx.reply('Subscription draft is incomplete. Use /subscribe again.');
        resetDraft(ctx);
        return;
      }

      const vault = getVaultById(db, vaultId);
      if (!vault) {
        await ctx.reply('Vault not found. Use /subscribe again.');
        resetDraft(ctx);
        return;
      }

      const currentCount = countActiveSubscriptionsForUser(db, identity.userId, identity.chatId);
      if (currentCount >= config.telegram.maxSubscriptionsPerUser) {
        await ctx.reply(`Subscription limit reached (${config.telegram.maxSubscriptionsPerUser}).`);
        resetDraft(ctx);
        return;
      }

      try {
        const thresholdAmount = parseHumanAmountToRaw(messageText, vault.decimals);
        upsertSubscription(db, {
          ...identity,
          vaultId: vault.vault_id,
          monitorType,
          thresholdAmount,
          decimals: vault.decimals,
        });

        resetDraft(ctx);
        await showMainMenu(
          ctx,
          [
            'Subscription saved.',
            formatVaultLabel(vault),
            `Monitor: ${monitorLabel(monitorType)}`,
            `Threshold: ${formatRawAmount(thresholdAmount, vault.decimals, vault.token_symbol)}`,
          ].join('\n'),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.reply(message);
      }
      return;
    }

    if (ctx.session.awaiting?.type === 'edit-threshold') {
      const subscription = getSubscriptionById(db, {
        id: ctx.session.awaiting.subscriptionId,
        ...identity,
      });

      if (!subscription) {
        ctx.session.awaiting = null;
        await ctx.reply('Subscription not found.');
        return;
      }

      try {
        const thresholdAmount = parseHumanAmountToRaw(messageText, subscription.decimals);
        updateSubscriptionThreshold(db, {
          id: subscription.id,
          ...identity,
          thresholdAmount,
          decimals: subscription.decimals,
        });
        ctx.session.awaiting = null;
        await showMainMenu(
          ctx,
          `Threshold updated to ${formatRawAmount(thresholdAmount, subscription.decimals, subscription.token_symbol)}.`,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.reply(message);
      }
      return;
    }
  });

  bot.catch((error) => {
    console.error('[telegram-bot] error', error.error);
  });

  return bot;
}
