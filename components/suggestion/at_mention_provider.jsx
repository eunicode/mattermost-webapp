// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';
import XRegExp from 'xregexp';

import {getCurrentUserId, getProfilesInCurrentChannel} from 'mattermost-redux/selectors/entities/users';

import {autocompleteUsersInChannel} from 'actions/user_actions.jsx';
import AppDispatcher from 'dispatcher/app_dispatcher.jsx';
import {ActionTypes, Constants} from 'utils/constants.jsx';
import * as Utils from 'utils/utils.jsx';
import store from 'stores/redux_store.jsx';
import SuggestionStore from 'stores/suggestion_store.jsx';

import Provider from './provider.jsx';
import Suggestion from './suggestion.jsx';

class AtMentionSuggestion extends Suggestion {
    render() {
        const isSelection = this.props.isSelection;
        const user = this.props.item;

        let username;
        let description;
        let icon;
        if (user.username === 'all') {
            username = 'all';
            description = (
                <FormattedMessage
                    id='suggestion.mention.all'
                    defaultMessage='CAUTION: This mentions everyone in channel'
                />
            );
            icon = (
                <i
                    className='mention__image fa fa-users fa-2x'
                    title={Utils.localizeMessage('generic_icons.member', 'Member Icon')}
                />
            );
        } else if (user.username === 'channel') {
            username = 'channel';
            description = (
                <FormattedMessage
                    id='suggestion.mention.channel'
                    defaultMessage='Notifies everyone in the channel'
                />
            );
            icon = (
                <i
                    className='mention__image fa fa-users fa-2x'
                    title={Utils.localizeMessage('generic_icons.member', 'Member Icon')}
                />
            );
        } else if (user.username === 'here') {
            username = 'here';
            description = (
                <FormattedMessage
                    id='suggestion.mention.here'
                    defaultMessage='Notifies everyone in the channel and online'
                />
            );
            icon = (
                <i
                    className='mention__image fa fa-users fa-2x'
                    title={Utils.localizeMessage('generic_icons.member', 'Member Icon')}
                />
            );
        } else {
            username = user.username;

            if ((user.first_name || user.last_name) && user.nickname) {
                description = `- ${Utils.getFullName(user)} (${user.nickname})`;
            } else if (user.nickname) {
                description = `- (${user.nickname})`;
            } else if (user.first_name || user.last_name) {
                description = `- ${Utils.getFullName(user)}`;
            }

            icon = (
                <img
                    className='mention__image'
                    src={Utils.imageURLForUser(user)}
                />
            );
        }

        let className = 'mentions__name';
        if (isSelection) {
            className += ' suggestion--selected';
        }

        return (
            <div
                className={className}
                onClick={this.handleClick}
                {...Suggestion.baseProps}
            >
                {icon}
                <span className='mention--align'>
                    {'@' + username}
                </span>
                <span className='mention__fullname'>
                    {' '}
                    {description}
                </span>
            </div>
        );
    }
}

export default class AtMentionProvider extends Provider {
    constructor(channelId) {
        super();

        this.channelId = channelId;
    }

    handlePretextChanged(suggestionId, pretext) {
        const captured = XRegExp.cache('(?:^|\\W)@([\\pL\\d\\-_.]*)$', 'i').exec(pretext.toLowerCase());
        if (!captured) {
            return false;
        }

        const state = store.getState();
        const currentUserId = getCurrentUserId(state);
        const prefix = captured[1];

        this.startNewRequest(suggestionId, prefix);

        SuggestionStore.clearSuggestions(suggestionId);

        const specialMentions = ['here', 'channel', 'all'].filter((item) =>
            item.startsWith(prefix)
        ).map((name) => ({
            username: name,
            type: Constants.MENTION_SPECIAL,
        }));

        const prefixLower = prefix.toLowerCase();
        const localMembers = getProfilesInCurrentChannel(state).
            filter((item) => item.id !== currentUserId).
            filter((item) =>
                (item.username && item.username.toLowerCase().startsWith(prefixLower)) ||
                (item.first_name && item.first_name.toLowerCase().startsWith(prefixLower)) ||
                (item.last_name && item.last_name.toLowerCase().startsWith(prefixLower)) ||
                (item.nickname && item.nickname.toLowerCase().startsWith(prefixLower))
            ).
            map((item) => ({
                type: Constants.MENTION_MEMBERS,
                ...item,
            })).
            sort((a, b) => {
                // TODO: right algorithm?
                if (a.username < b.username) {
                    return -1;
                } else if (a.username > b.username) {
                    return 1;
                }
                return 0;
            }).
            splice(0, 25);

        const localUserIds = {};
        localMembers.forEach((item) => {
            localUserIds[item.id] = true;
        });

        const loadingUsers = [{
            type: Constants.MENTION_MORE_MEMBERS,
            loading: true,
        }];
        const loadingMentions = [''];

        const members = specialMentions.concat(localMembers).concat(loadingUsers);
        const userMentions = specialMentions.concat(localMembers).map((item) => '@' + item.username).concat(loadingMentions);

        // if (userMentions.length > 0) {
        //     SuggestionStore.addSuggestions(suggestionId, userMentions, members, AtMentionSuggestion, prefix);
        // }

        // SuggestionStore.addSuggestions(suggestionId, [''], [{
        //     type: Constants.MENTION_MORE_MEMBERS,
        //     loading: true,
        // }], AtMentionSuggestion, prefix);

        setTimeout(() => AppDispatcher.handleServerAction({
            type: ActionTypes.SUGGESTION_RECEIVED_SUGGESTIONS,
            id: suggestionId,
            matchedPretext: `@${captured[1]}`,
            terms: userMentions,
            items: members,
            component: AtMentionSuggestion,
        }), 0);

        autocompleteUsersInChannel(
            prefix,
            this.channelId,
            (data) => {
                if (this.shouldCancelDispatch(prefix)) {
                    return;
                }
                if (!data) {
                    return;
                }

                const remoteMembers = (data.users || []).map((user) => ({
                    type: Constants.MENTION_MEMBERS,
                    ...user,
                })).filter((user) =>
                    !localUserIds[user.id]
                ).filter((user) =>
                    user.id !== currentUserId
                );

                const members = localMembers.concat(remoteMembers).sort((a, b) => {
                    // TODO: right algorithm?
                    if (a.username < b.username) {
                        return -1;
                    } else if (a.username > b.username) {
                        return 1;
                    }
                    return 0;
                });

                const remoteNonMembers = (data.out_of_channel || []).map((user) => ({
                    type: Constants.MENTION_NONMEMBERS,
                    ...user,
                }));

                const users = specialMentions.
                    concat(members).
                    concat(remoteNonMembers);
                const mentions = users.map((user) => '@' + user.username);

                AppDispatcher.handleServerAction({
                    type: ActionTypes.SUGGESTION_RECEIVED_SUGGESTIONS,
                    id: suggestionId,
                    matchedPretext: `@${captured[1]}`,
                    terms: mentions,
                    items: users,
                    component: AtMentionSuggestion,
                });
            }
        );

        return true;
    }
}
