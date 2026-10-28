import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Icon } from './Icon';
import { useTheme, radius, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { agent, agentStore } from '@/state/agent';
import { companionById, faceFor } from '@/lib/companions';
import type { AgentRun, AgentStep } from '@/lib/types';
import { Glass, IconButton, T, Tap, Button, haptic } from './ui';

const STATUS: Record<AgentRun['status'], string> = {
  running: 'Working',
  'waiting-approval': 'Needs approval',
  'waiting-user': 'Question',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};

const StepRow = memo(function StepRow({ step }: { step: AgentStep }) {
  const t = useTheme();
  const glyph =
    step.kind === 'tool' ? <Icon name="wrench" size={14} color={t.ink2} /> :
    step.kind === 'thought' ? <Icon name="brain-circuit" size={14} color={t.ink3} /> :
    step.kind === 'user' ? <Icon name="person" size={14} color={t.ink2} /> :
    step.kind === 'error' ? <Icon name="warning" size={14} color={t.danger} /> :
    step.kind === 'approval' ? <Icon name="checkmark" size={14} color={t.accent} /> :
    step.kind === 'message' ? <Icon name="checkmark-circle" size={14} color={t.accent} /> : null;
  if (step.kind === 'result') {
    return <T kind="small" numberOfLines={3} color={t.ink3} style={styles.result}>{step.text}</T>;
  }
  const isFinal = step.kind === 'message';
  return (
    <View style={[styles.step, isFinal && { backgroundColor: t.surface, borderRadius: radius.md, padding: space.sm, marginVertical: space.xs }]}>
      <View style={styles.stepIcon}>{glyph}</View>
      <T selectable style={{ flex: 1, fontSize: isFinal ? 15 : 14, lineHeight: isFinal ? 22 : 20 }} color={step.kind === 'thought' ? t.ink2 : step.kind === 'error' ? t.danger : t.ink}>
        {step.text}
      </T>
    </View>
  );
});

/** Live run view: steps timeline, approval/question cards, follow-ups and Stop. */
export function RunSheet({ lift = 0 }: { lift?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const open = useStore(agentStore, (s) => s.sheetOpen);
  const run = useStore(agentStore, (s) => s.runs.find((r) => r.id === (s.activeRunId || s.viewRunId)) || s.runs[0] || null);
  const [reply, setReply] = useState('');
  const slide = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<AgentStep>>(null);

  useEffect(() => {
    Animated.spring(slide, { toValue: open ? 1 : 0, useNativeDriver: true, ...motion.spring.sheet }).start();
  }, [open, slide]);

  useEffect(() => {
    if (run?.status === 'waiting-approval' || run?.status === 'waiting-user') haptic('warning');
    if (run?.status === 'done') haptic('success');
  }, [run?.status]);

  const renderItem = useCallback(({ item }: { item: AgentStep }) => <StepRow step={item} />, []);

  if (!run) return null;
  const c = companionById(run.companionId);
  const live = run.status === 'running' || run.status === 'waiting-approval' || run.status === 'waiting-user';
  const sheetH = Math.min(height * 0.62, 560, Math.max(260, height - lift - 80));
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [sheetH + 40, 0] });

  const send = () => {
    const v = reply.trim();
    if (!v) return;
    if (live) agent.answer(run.id, v);
    else agent.start(v, run.companionId);
    setReply('');
  };

  return (
    <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.wrap, { height: sheetH + insets.bottom, bottom: lift, transform: [{ translateY }] }]}>
      <View style={{ flex: 1 }}>
        <Glass style={{ flex: 1, borderBottomLeftRadius: lift ? radius.sheet : 0, borderBottomRightRadius: lift ? radius.sheet : 0 }} rounded={radius.sheet} intensity={80} live={false}>
          <View style={styles.grabber}><View style={[styles.grab, { backgroundColor: t.ink3 }]} /></View>
          <View style={styles.head}>
            <Image source={faceFor(c.id)} style={styles.face} contentFit="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T kind="headline" numberOfLines={1}>{run.task}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {run.status === 'running' ? <ActivityIndicator size="small" color={t.ink2} /> : null}
                <T kind="footnote" numberOfLines={1}>{c.name} · {STATUS[run.status]}</T>
              </View>
            </View>
            {live ? (
              <IconButton label="Stop" tint={t.surface2} icon={<Icon name="stop" size={14} color={t.ink} filled />} onPress={() => { haptic('medium'); agent.stop(run.id); }} />
            ) : null}
            <IconButton label="Hide" icon={<Icon name="chevron-down" size={icon.lg} color={t.ink2} />} onPress={() => agent.openSheet(false)} />
          </View>

          <FlatList
            ref={listRef}
            data={run.steps}
            keyExtractor={(s, i) => s.t + ':' + i}
            renderItem={renderItem}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            removeClippedSubviews
            windowSize={7}
          />

          {run.status === 'waiting-approval' && run.pendingApproval ? (
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <T kind="headline">{run.pendingApproval.action}</T>
              {run.pendingApproval.detail ? <T kind="footnote" style={{ marginTop: 4 }}>{run.pendingApproval.detail}</T> : null}
              <View style={styles.cardBtns}>
                <Button title="Deny" kind="secondary" onPress={() => agent.approve(run.id, false)} style={{ flex: 1 }} />
                <Button title="Approve" onPress={() => { haptic('success'); agent.approve(run.id, true); }} style={{ flex: 1 }} />
              </View>
            </View>
          ) : null}

          {run.status === 'waiting-user' && run.pendingQuestion ? (
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <T kind="headline">{run.pendingQuestion.question}</T>
            </View>
          ) : null}

          <View style={[styles.replyRow, { paddingBottom: (lift ? 0 : insets.bottom) + space.xs }]}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder={run.status === 'waiting-user' ? 'Answer' : live ? `Message ${c.name}` : 'Follow up'}
              placeholderTextColor={t.ink3}
              selectionColor={t.accentFill}
              style={[styles.replyInput, { color: t.ink, backgroundColor: t.surface2 }]}
              onSubmitEditing={send}
              returnKeyType="send"
              accessibilityLabel="Reply to companion"
            />
            <IconButton label="Send" disabled={!reply.trim()} tint={reply.trim() ? t.accentFill : t.surface2} icon={<Icon name="arrow-up" size={icon.md} color={reply.trim() ? t.accentInk : t.ink3} />} onPress={send} />
          </View>
        </Glass>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0 },
  grabber: { alignItems: 'center', paddingTop: space.xs, paddingBottom: space.xxs },
  grab: { width: 36, height: 4, borderRadius: 2, opacity: 0.45 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: space.xs, paddingBottom: space.xs },
  face: { width: 36, height: 36, borderRadius: 18 },
  step: { flexDirection: 'row', gap: space.xs, paddingVertical: 5 },
  stepIcon: { width: 18, paddingTop: 3, alignItems: 'center' },
  result: { marginLeft: 26, marginBottom: 4, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11.5 },
  card: { marginHorizontal: space.sm, marginBottom: space.xs, padding: space.md, borderRadius: radius.lg, borderCurve: 'continuous' },
  cardBtns: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.xs },
  replyInput: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: space.md, fontSize: 16 },
});
