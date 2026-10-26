import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Square, ChevronDown, Check, X, Send, AlertTriangle, MessageCircleQuestion, CircleCheck, Wrench, Brain, User } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { agent, agentStore } from '@/state/agent';
import { companionById, faceFor } from '@/lib/companions';
import type { AgentRun, AgentStep } from '@/lib/types';
import { Glass, IconButton, T, Tap, Button, haptic } from './ui';

const STATUS: Record<AgentRun['status'], string> = {
  running: 'Working…',
  'waiting-approval': 'Needs your OK',
  'waiting-user': 'Has a question',
  done: 'Done',
  failed: 'Ran into a problem',
  stopped: 'Stopped',
};

const StepRow = memo(function StepRow({ step, color }: { step: AgentStep; color: string }) {
  const t = useTheme();
  const icon =
    step.kind === 'tool' ? <Wrench size={14} color={color} /> :
    step.kind === 'thought' ? <Brain size={14} color={t.ink3} /> :
    step.kind === 'user' ? <User size={14} color={t.ink2} /> :
    step.kind === 'error' ? <AlertTriangle size={14} color={t.danger} /> :
    step.kind === 'approval' ? <Check size={14} color={t.warn} /> :
    step.kind === 'message' ? <CircleCheck size={14} color={t.success} /> : null;
  if (step.kind === 'result') {
    return <T kind="small" numberOfLines={3} color={t.ink3} style={styles.result}>{step.text}</T>;
  }
  const isFinal = step.kind === 'message';
  return (
    <View style={[styles.step, isFinal && { backgroundColor: t.surface2, borderRadius: radius.md, padding: 12, marginVertical: 6 }]}>
      <View style={styles.stepIcon}>{icon}</View>
      <T selectable style={{ flex: 1, fontSize: isFinal ? 15 : 14, lineHeight: isFinal ? 22 : 20 }} color={step.kind === 'thought' ? t.ink2 : step.kind === 'error' ? t.danger : t.ink}>
        {step.text}
      </T>
    </View>
  );
});

/** Live run view: steps timeline, approval/question cards, follow-ups and Stop. */
export function RunSheet() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const open = useStore(agentStore, (s) => s.sheetOpen);
  const run = useStore(agentStore, (s) => s.runs.find((r) => r.id === (s.activeRunId || s.viewRunId)) || s.runs[0] || null);
  const [reply, setReply] = useState('');
  const slide = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<AgentStep>>(null);

  useEffect(() => {
    Animated.spring(slide, { toValue: open ? 1 : 0, useNativeDriver: true, damping: 22, stiffness: 220, mass: 0.9 }).start();
  }, [open, slide]);

  useEffect(() => {
    if (run?.status === 'waiting-approval' || run?.status === 'waiting-user') haptic('warning');
    if (run?.status === 'done') haptic('success');
  }, [run?.status]);

  const renderItem = useCallback(({ item }: { item: AgentStep }) => <StepRow step={item} color={run ? companionById(run.companionId).look.body : t.accent} />, [run, t.accent]);

  if (!run) return null;
  const c = companionById(run.companionId);
  const live = run.status === 'running' || run.status === 'waiting-approval' || run.status === 'waiting-user';
  const sheetH = Math.min(height * 0.62, 560);
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [sheetH + 40, 0] });

  const send = () => {
    const v = reply.trim();
    if (!v) return;
    if (live) agent.answer(run.id, v);
    else agent.start(v, run.companionId);
    setReply('');
  };

  return (
    <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.wrap, { height: sheetH + insets.bottom, transform: [{ translateY }] }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <Glass style={{ flex: 1, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} rounded={radius.xl} intensity={90}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.ground, opacity: Platform.OS === 'ios' ? 0.55 : 0 }]} />
          <View style={styles.grabber}><View style={[styles.grab, { backgroundColor: t.ink3 }]} /></View>
          <View style={styles.head}>
            <View style={[styles.face, { backgroundColor: c.look.body + '33' }]}>
              <Image source={faceFor(c.id)} style={{ width: 34, height: 34 }} contentFit="contain" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{c.name}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {run.status === 'running' ? <ActivityIndicator size="small" color={c.look.body} /> : null}
                <T kind="small" numberOfLines={1}>{STATUS[run.status]} · {run.task}</T>
              </View>
            </View>
            {live ? (
              <Tap label="Stop" onPress={() => agent.stop(run.id)} style={[styles.stop, { backgroundColor: t.danger }]}>
                <Square size={12} color="#fff" fill="#fff" />
                <T style={{ fontSize: 14, fontWeight: '600' }} color="#fff">Stop</T>
              </Tap>
            ) : null}
            <IconButton label="Hide" icon={<ChevronDown size={22} color={t.ink2} />} onPress={() => agent.openSheet(false)} />
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
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.warn }]}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <AlertTriangle size={18} color={t.warn} />
                <T style={{ fontWeight: '600', flex: 1 }}>{c.name} wants to: {run.pendingApproval.action}</T>
              </View>
              {run.pendingApproval.detail ? <T kind="small" style={{ marginTop: 4 }}>{run.pendingApproval.detail}</T> : null}
              <View style={styles.cardBtns}>
                <Button title="Deny" kind="secondary" icon={<X size={16} color={t.ink} />} onPress={() => agent.approve(run.id, false)} style={{ flex: 1 }} />
                <Button title="Approve" icon={<Check size={16} color={t.accentInk} />} onPress={() => agent.approve(run.id, true)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : null}

          {run.status === 'waiting-user' && run.pendingQuestion ? (
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.accent }]}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <MessageCircleQuestion size={18} color={t.accent} />
                <T style={{ fontWeight: '600', flex: 1 }}>{run.pendingQuestion.question}</T>
              </View>
              <T kind="small" style={{ marginTop: 4 }}>Answer below, or hide this sheet to use the page yourself (e.g. to sign in), then answer.</T>
            </View>
          ) : null}

          <View style={[styles.replyRow, { paddingBottom: insets.bottom + 8, borderTopColor: t.line }]}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder={run.status === 'waiting-user' ? 'Your answer…' : live ? `Tell ${c.name} something…` : `Ask ${c.name} a follow-up…`}
              placeholderTextColor={t.ink3}
              style={[styles.replyInput, { color: t.ink, backgroundColor: t.surface2 }]}
              onSubmitEditing={send}
              returnKeyType="send"
              accessibilityLabel="Reply to companion"
            />
            <IconButton label="Send" disabled={!reply.trim()} tint={reply.trim() ? t.accent : t.surface2} icon={<Send size={18} color={reply.trim() ? t.accentInk : t.ink3} />} onPress={send} />
          </View>
        </Glass>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: -6 }, elevation: 24 },
  grabber: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  grab: { width: 38, height: 5, borderRadius: 3, opacity: 0.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  face: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17 },
  step: { flexDirection: 'row', gap: 8, paddingVertical: 5 },
  stepIcon: { width: 18, paddingTop: 3, alignItems: 'center' },
  result: { marginLeft: 26, marginBottom: 4, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11.5 },
  card: { marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: radius.lg, borderWidth: 1.5 },
  cardBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  replyInput: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16, fontSize: 16 },
});
