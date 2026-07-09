import React, { useEffect, useState, useCallback, useRef, useMemo, createContext, useContext } from "react";
import {
  ActivityIndicator, Alert, Animated, Appearance, BackHandler, Easing, FlatList, LayoutAnimation,
  Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text,
  TextInput, UIManager, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image as ExpoImage } from "expo-image";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  FileItem, Me, listFiles, loadSession, login, logout, getThumb, getCapacity,
  renameFile, deleteFiles, createFolder, changePassword, fetchMe, avatarUrl, authHeader, serverUrlValue,
} from "./src/api";
import { uploadFile, PickedFile } from "./src/upload";
import { useShareIntent } from "expo-share-intent";
import { subscribe as subscribeLogs, clearLog } from "./src/logstore";
import {
  Palette, ThemeMode, dark, light, fmtSize, fmtDate, kindOf, kindFeather,
} from "./src/theme";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const easeNext = () =>
  LayoutAnimation.configureNext({
    duration: 200,
    update: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });

/* ---------------- THEME CONTEXT ---------------- */

const ThemeCtx = createContext<{ C: Palette; mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  C: dark, mode: "system", setMode: () => {},
});
const useTheme = () => useContext(ThemeCtx);
const useStyles = () => { const { C } = useTheme(); return useMemo(() => makeStyles(C), [C]); };

const K_THEME = "cr_theme_mode";

type Crumb = { name: string; uri: string };

const SHORTCUTS: { icon: FeatherName; name: string; uri: string }[] = [
  { icon: "home", name: "Mes fichiers", uri: "cloudreve://my/" },
  { icon: "image", name: "Photos", uri: "cloudreve://my/?category=image" },
  { icon: "film", name: "Vidéos", uri: "cloudreve://my/?category=video" },
  { icon: "music", name: "Musique", uri: "cloudreve://my/?category=audio" },
  { icon: "file-text", name: "Documents", uri: "cloudreve://my/?category=document" },
  { icon: "trash-2", name: "Corbeille", uri: "cloudreve://trash/" },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [sys, setSys] = useState(Appearance.getColorScheme());

  useEffect(() => {
    (async () => {
      const m = (await AsyncStorage.getItem(K_THEME)) as ThemeMode | null;
      if (m) setModeState(m);
      const ok = await loadSession();
      setAuthed(ok); setBooting(false);
    })();
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSys(colorScheme));
    return () => sub.remove();
  }, []);

  const setMode = (m: ThemeMode) => { setModeState(m); AsyncStorage.setItem(K_THEME, m); };
  const C = useMemo(() => {
    const effective = mode === "system" ? (sys === "light" ? light : dark) : mode === "light" ? light : dark;
    return effective;
  }, [mode, sys]);

  if (booting)
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.accent} size="large" /></View>;

  return (
    <ThemeCtx.Provider value={{ C, mode, setMode }}>
      <SafeAreaProvider>
        <StatusBar barStyle={C.dark ? "light-content" : "dark-content"} backgroundColor={C.bg} />
        {authed ? <Browser onLogout={() => setAuthed(false)} /> : <Login onDone={() => setAuthed(true)} />}
      </SafeAreaProvider>
    </ThemeCtx.Provider>
  );
}

/* ---------------- LOGIN ---------------- */

function Login({ onDone }: { onDone: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  const [server, setServer] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => subscribeLogs(setLogs), []);

  async function submit() {
    if (!server || !email || !pw) return;
    setBusy(true); clearLog();
    try { await login(server, email.trim(), pw); onDone(); } catch {} finally { setBusy(false); }
  }
  return (
    <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 26, alignItems: "center", flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
        <View style={s.loginLogo}><Feather name="cloud" size={40} color={C.accent} /></View>
        <Text style={s.logo}>Cloudreve</Text>
        <Text style={s.logoSub}>Ton cloud, dans ta poche</Text>
        <View style={{ height: 30 }} />
        <Field label="Serveur" value={server} onChange={setServer} placeholder="https://cloudreve.exemple.com" autoCap="none" kbd="url" />
        <Field label="Email" value={email} onChange={setEmail} placeholder="toi@exemple.fr" autoCap="none" kbd="email-address" />
        <Field label="Mot de passe" value={pw} onChange={setPw} placeholder="••••••••" secure />
        <Pressable style={({ pressed }) => [s.btn, (busy || pressed) && { opacity: 0.75 }]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>Se connecter</Text>}
        </Pressable>
        {logs.length > 0 && (
          <View style={s.logBox}><Text style={s.logTitle}>Journal</Text>{logs.map((l, i) => <Text key={i} style={s.logLine} selectable>{l}</Text>)}</View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; secure?: boolean; autoCap?: "none" | "sentences"; kbd?: any }) {
  const { C } = useTheme(); const s = useStyles();
  return (
    <View style={{ width: "100%", marginBottom: 14 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput style={s.input} value={props.value} onChangeText={props.onChange} placeholder={props.placeholder}
        placeholderTextColor={C.faint} secureTextEntry={props.secure} autoCapitalize={props.autoCap || "sentences"}
        autoCorrect={false} keyboardType={props.kbd} />
    </View>
  );
}

/* ---------------- BROWSER ---------------- */

function Browser({ onLogout }: { onLogout: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  const [stack, setStack] = useState<Crumb[]>([{ name: "Mes fichiers", uri: "cloudreve://my/" }]);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<FileItem | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [cap, setCap] = useState<{ total: number; used: number } | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  const [query, setQuery] = useState("");
  const [addMenu, setAddMenu] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [settings, setSettings] = useState(false);
  const [upload, setUpload] = useState<{ label: string; done: number; total: number; prog: number } | null>(null);
  const crumbRef = useRef<ScrollView>(null);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });

  const cur = stack[stack.length - 1];
  const isSearch = cur.uri.includes("?name=");
  const canUpload = cur.uri.startsWith("cloudreve://my/") && !cur.uri.includes("?");

  useEffect(() => { getCapacity().then(setCap).catch(() => {}); }, []);

  const load = useCallback(async (uri: string) => {
    setLoading(true); setError("");
    try {
      const files = await listFiles(uri);
      files.sort((a, b) => (b.type - a.type) || a.name.localeCompare(b.name));
      easeNext(); setItems(files);
    } catch (e: any) {
      setError(e.message || "Erreur de chargement");
      if (e.code === 401 || e.code === 40001) { await logout(); onLogout(); }
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(cur.uri); }, [cur.uri, load]);
  useEffect(() => { setTimeout(() => crumbRef.current?.scrollToEnd({ animated: true }), 80); }, [stack.length]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (settings) { setSettings(false); return true; }
      if (addMenu) { setAddMenu(false); return true; }
      if (drawer) { setDrawer(false); return true; }
      if (searchOn) { setSearchOn(false); setQuery(""); return true; }
      if (sel) { setSel(null); return true; }
      if (stack.length > 1) { setStack((st) => st.slice(0, -1)); return true; }
      return false;
    });
    return () => sub.remove();
  }, [sel, stack.length, drawer, addMenu, searchOn, settings]);

  function openItem(it: FileItem) {
    if (it.type === 1) setStack([...stack, { name: it.name, uri: it.path.replace(/\/?$/, "/") }]);
    else setSel(it);
  }
  function goTo(i: number) { if (i < stack.length - 1) setStack(stack.slice(0, i + 1)); }
  function goRoot(sc: { name: string; uri: string }) { setDrawer(false); setStack([{ name: sc.name, uri: sc.uri }]); }
  function runSearch() {
    const q = query.trim(); if (!q) return;
    setSearchOn(false);
    setStack((st) => [...st, { name: `Recherche : ${q}`, uri: `cloudreve://my/?name=${encodeURIComponent(q)}` }]);
  }

  async function uploadTo(target: string, files: PickedFile[]) {
    if (!files.length) return;
    let done = 0;
    for (const f of files) {
      setUpload({ label: f.name, done, total: files.length, prog: 0 });
      try { await uploadFile(target, f, (r) => setUpload({ label: f.name, done, total: files.length, prog: r })); }
      catch (e: any) { setUpload(null); Alert.alert("Envoi échoué", `« ${f.name} » : ${e.message}`); return; }
      done++;
    }
    setUpload(null);
    if (target === cur.uri) load(cur.uri);
    else setStack([{ name: "Mes fichiers", uri: "cloudreve://my/" }]);
  }
  async function doUpload(files: PickedFile[]) {
    setAddMenu(false);
    await uploadTo(cur.uri, files);
  }

  // Partage entrant depuis Android (menu « Partager » → Cloudreve).
  useEffect(() => {
    if (!hasShareIntent) return;
    const files: PickedFile[] = ((shareIntent?.files as any[]) || [])
      .filter((f) => f?.path)
      .map((f) => ({
        uri: f.path,
        name: f.fileName || String(f.path).split("/").pop() || `partage-${Date.now()}`,
        size: f.size || 0,
        mime: f.mimeType || "application/octet-stream",
      }));
    resetShareIntent();
    if (files.length) {
      const target = canUpload ? cur.uri : "cloudreve://my/";
      uploadTo(target, files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);
  async function pickDocuments() {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) { setAddMenu(false); return; }
    const files: PickedFile[] = [];
    for (const a of res.assets) {
      let size = a.size ?? 0;
      if (!size) { try { const info = await FileSystem.getInfoAsync(a.uri); size = (info as any).size ?? 0; } catch {} }
      files.push({ uri: a.uri, name: a.name, size, mime: a.mimeType || "application/octet-stream" });
    }
    doUpload(files);
  }
  async function pickMedia() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setAddMenu(false); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, allowsMultipleSelection: true, quality: 1 });
    if (res.canceled) { setAddMenu(false); return; }
    const files: PickedFile[] = [];
    for (const a of res.assets) {
      let size = a.fileSize ?? 0;
      if (!size) { try { const info = await FileSystem.getInfoAsync(a.uri); size = (info as any).size ?? 0; } catch {} }
      const name = a.fileName || a.uri.split("/").pop() || `media-${Date.now()}`;
      files.push({ uri: a.uri, name, size, mime: a.mimeType || (a.type === "video" ? "video/mp4" : "image/jpeg") });
    }
    doUpload(files);
  }
  async function createNewFolder(name: string) {
    setNewFolder(false);
    try { await createFolder(cur.uri, name); load(cur.uri); } catch (e: any) { Alert.alert("Erreur", e.message); }
  }

  return (
    <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
      <View style={s.header}>
        {searchOn ? (
          <>
            <IconBtn name="arrow-left" onPress={() => { setSearchOn(false); setQuery(""); }} />
            <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Rechercher…"
              placeholderTextColor={C.faint} autoFocus returnKeyType="search" onSubmitEditing={runSearch} />
            {query.length > 0 && <IconBtn name="x" onPress={() => setQuery("")} />}
          </>
        ) : (
          <>
            <IconBtn name="menu" onPress={() => setDrawer(true)} />
            <Text style={s.headerTitle} numberOfLines={1}>{cur.name}</Text>
            <IconBtn name="search" onPress={() => setSearchOn(true)} />
            <IconBtn name="rotate-cw" onPress={() => load(cur.uri)} size={20} />
          </>
        )}
      </View>

      {stack.length > 1 && !searchOn && (
        <ScrollView ref={crumbRef} horizontal showsHorizontalScrollIndicator={false} style={s.crumbs} contentContainerStyle={{ alignItems: "center", paddingRight: 14 }}>
          {stack.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Text style={s.crumbSep}>›</Text>}
              <Pressable onPress={() => goTo(i)} style={[s.crumbChip, i === stack.length - 1 && s.crumbChipActive]}>
                {i === 0 ? <Feather name="home" size={14} color={i === stack.length - 1 ? C.accent : C.sub} />
                  : <Text style={[s.crumbTxt, i === stack.length - 1 && s.crumbTxtActive]} numberOfLines={1}>{c.name}</Text>}
              </Pressable>
            </React.Fragment>
          ))}
        </ScrollView>
      )}

      {loading ? <Skeleton /> : error ? (
        <View style={[s.fill, s.center, { padding: 24 }]}>
          <Feather name="alert-triangle" size={40} color={C.warn} />
          <Text style={{ color: C.sub, textAlign: "center", marginTop: 12 }}>{error}</Text>
          <Pressable style={[s.btn, { marginTop: 18, width: 160 }]} onPress={() => load(cur.uri)}><Text style={s.btnTxt}>Réessayer</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.path}
          contentContainerStyle={items.length === 0 ? s.fill : { paddingVertical: 6, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(cur.uri)} tintColor={C.accent} colors={[C.accent]} />}
          ListEmptyComponent={
            <View style={[s.fill, s.center]}>
              <Feather name={isSearch ? "search" : "folder"} size={44} color={C.faint} />
              <Text style={{ color: C.sub, marginTop: 10 }}>{isSearch ? "Aucun résultat" : "Dossier vide"}</Text>
            </View>
          }
          renderItem={({ item }) => <Row item={item} onPress={() => openItem(item)} onMore={() => setSel(item)} />}
        />
      )}

      {canUpload && !upload && (
        <View style={s.fabWrap}>
          <Pressable style={({ pressed }) => [s.fab, pressed && { opacity: 0.9, transform: [{ scale: 0.96 }] }]} onPress={() => setAddMenu(true)}>
            <Feather name="plus" size={28} color="#fff" />
          </Pressable>
        </View>
      )}

      {addMenu && (
        <BottomSheet title={`Ajouter dans « ${cur.name} »`} onClose={() => setAddMenu(false)}>
          <SheetAction icon="image" tint={C.kindTint.image} title="Photo / Vidéo" sub="Depuis la galerie" onPress={pickMedia} />
          <SheetAction icon="file" tint={C.kindTint.doc} title="Fichier" sub="Documents, archives, tout type" onPress={pickDocuments} />
          <SheetAction icon="folder-plus" tint={C.folder} title="Nouveau dossier" sub="Créer un dossier ici" onPress={() => { setAddMenu(false); setNewFolder(true); }} />
        </BottomSheet>
      )}

      {newFolder && <TextPrompt title="Nouveau dossier" placeholder="Nom du dossier" confirm="Créer" onCancel={() => setNewFolder(false)} onConfirm={createNewFolder} />}

      {upload && (
        <Modal transparent animationType="fade" visible>
          <View style={[s.fill, s.center, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <View style={s.upCard}>
              <ActivityIndicator color={C.accent} size="large" />
              <Text style={s.upTitle}>Envoi · {upload.done + 1}/{upload.total}</Text>
              <Text style={s.upName} numberOfLines={1}>{upload.label}</Text>
              <View style={s.progTrack}><View style={[s.progFill, { width: `${Math.round(upload.prog * 100)}%` }]} /></View>
              <Text style={s.rowMeta}>{Math.round(upload.prog * 100)}%</Text>
            </View>
          </View>
        </Modal>
      )}

      {sel && <FileSheet item={sel} onClose={() => setSel(null)} onChanged={() => { setSel(null); load(cur.uri); }} />}

      <Drawer visible={drawer} activeUri={cur.uri} cap={cap} onPick={goRoot} onClose={() => setDrawer(false)} onSettings={() => { setDrawer(false); setSettings(true); }} />
      {settings && <Settings cap={cap} onClose={() => setSettings(false)} onLogout={async () => { await logout(); onLogout(); }} />}
    </SafeAreaView>
  );
}

function IconBtn({ name, onPress, size = 22 }: { name: FeatherName; onPress: () => void; size?: number }) {
  const { C } = useTheme(); const s = useStyles();
  return (
    <Pressable hitSlop={10} onPress={onPress} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
      <Feather name={name} size={size} color={C.text} />
    </Pressable>
  );
}

/* ---------------- ROW + THUMB ---------------- */

const THUMBABLE = new Set(["image", "video", "pdf", "audio", "doc"]);

function Thumb({ item, kind }: { item: FileItem; kind: any }) {
  const { C } = useTheme(); const s = useStyles();
  const [uri, setUri] = useState<string | null>(THUMBABLE.has(kind) ? null : "");
  useEffect(() => {
    if (!THUMBABLE.has(kind)) return;
    let alive = true;
    getThumb(item.path).then((u) => alive && setUri(u)).catch(() => alive && setUri(""));
    return () => { alive = false; };
  }, [item.path, kind]);
  const tint = C.kindTint[kind as keyof typeof C.kindTint] || C.kindTint.file;
  if (uri) return <ExpoImage source={uri} style={s.thumb} contentFit="cover" transition={200} cachePolicy="memory-disk" />;
  return <View style={[s.thumbBox, { backgroundColor: tint.bg }]}><Feather name={(kindFeather as any)[kind] as FeatherName} size={20} color={tint.fg} /></View>;
}

function Row({ item, onPress, onMore }: { item: FileItem; onPress: () => void; onMore: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  const isFolder = item.type === 1;
  const kind = kindOf(item.name);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true, easing: Easing.out(Easing.quad) }).start(); }, []);
  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.cardAlt }]} onPress={onPress} android_ripple={{ color: C.cardAlt }}>
        {isFolder ? <View style={[s.thumbBox, { backgroundColor: C.folder.bg }]}><Feather name="folder" size={21} color={C.folder.fg} /></View> : <Thumb item={item} kind={kind} />}
        <View style={{ flex: 1, minWidth: 0, marginLeft: 13 }}>
          <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.rowMeta}>{isFolder ? "Dossier" : fmtSize(item.size)} · {fmtDate(item.updated_at)}</Text>
        </View>
        <Pressable hitSlop={12} onPress={onMore} style={({ pressed }) => [s.moreBtn, pressed && { opacity: 0.5 }]}>
          <Feather name="more-vertical" size={20} color={C.sub} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function Skeleton() {
  const { C } = useTheme(); const s = useStyles();
  const sh = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(sh, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(sh, { toValue: 0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ])).start();
  }, []);
  const opacity = sh.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  return (
    <View style={{ paddingVertical: 6 }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={s.row}>
          <Animated.View style={[s.thumbBox, { backgroundColor: C.cardAlt, opacity }]} />
          <View style={{ flex: 1, marginLeft: 13 }}>
            <Animated.View style={{ height: 13, borderRadius: 5, backgroundColor: C.cardAlt, opacity, width: `${55 + (i % 4) * 10}%` }} />
            <Animated.View style={{ height: 10, borderRadius: 5, backgroundColor: C.cardAlt, opacity, width: "32%", marginTop: 8 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ---------------- FILE SHEET ---------------- */

function FileSheet({ item, onClose, onChanged }: { item: FileItem; onClose: () => void; onChanged: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  const [busy, setBusy] = useState<"" | "open" | "share">("");
  const [prog, setProg] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const kind = kindOf(item.name);
  const isFolder = item.type === 1;
  const tint = C.kindTint[kind as keyof typeof C.kindTint] || C.kindTint.file;
  useEffect(() => subscribeLogs(setLogs), []);

  async function run(mode: "open" | "share") {
    setBusy(mode); setProg(0); clearLog();
    try {
      const { openNative, saveOrShare } = await import("./src/fileActions");
      if (mode === "open") await openNative(item, setProg); else await saveOrShare(item, setProg);
      onClose();
    } catch { setShowLogs(true); } finally { setBusy(""); }
  }
  async function doRename(name: string) {
    setRenaming(false);
    try { await renameFile(item.path, name); onChanged(); } catch (e: any) { Alert.alert("Erreur", e.message); }
  }
  function confirmDelete() {
    Alert.alert("Supprimer", `Déplacer « ${item.name} » vers la corbeille ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { try { await deleteFiles([item.path]); onChanged(); } catch (e: any) { Alert.alert("Erreur", e.message); } } },
    ]);
  }
  if (renaming) return <TextPrompt title="Renommer" placeholder="Nouveau nom" initial={item.name} confirm="Renommer" onCancel={() => setRenaming(false)} onConfirm={doRename} />;

  return (
    <BottomSheet onClose={busy ? undefined : onClose}>
      <View style={s.sheetHead}>
        <View style={[s.thumbBox, { backgroundColor: isFolder ? C.folder.bg : tint.bg, width: 46, height: 46 }]}>
          <Feather name={(isFolder ? "folder" : (kindFeather as any)[kind]) as FeatherName} size={22} color={isFolder ? C.folder.fg : tint.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
          <Text style={s.sheetName} numberOfLines={2}>{item.name}</Text>
          <Text style={s.rowMeta}>{isFolder ? "Dossier" : fmtSize(item.size)} · {fmtDate(item.updated_at)}</Text>
        </View>
      </View>
      {busy ? (
        <View style={{ paddingVertical: 22, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
          <Text style={{ color: C.sub, marginTop: 10 }}>{busy === "open" ? "Ouverture" : "Préparation"} · {Math.round(prog * 100)}%</Text>
          <View style={s.progTrack}><View style={[s.progFill, { width: `${Math.round(prog * 100)}%` }]} /></View>
        </View>
      ) : (
        <>
          {!isFolder && <SheetAction icon="play" tint={{ bg: C.accentDim, fg: C.accent }} title="Ouvrir" sub={`Dans l'app adaptée (${kind === "video" ? "lecteur vidéo" : kind === "pdf" ? "lecteur PDF" : "app native"})`} onPress={() => run("open")} />}
          {!isFolder && <SheetAction icon="download" tint={{ bg: C.kindTint.image.bg, fg: C.green }} title="Enregistrer / Partager" sub="Téléchargements, Drive, autre app…" onPress={() => run("share")} />}
          <SheetAction icon="edit-2" tint={{ bg: C.kindTint.doc.bg, fg: C.accent2 }} title="Renommer" onPress={() => setRenaming(true)} />
          <SheetAction icon="trash-2" tint={{ bg: C.kindTint.pdf.bg, fg: C.danger }} title="Supprimer" danger onPress={confirmDelete} />
        </>
      )}
      {(showLogs || busy) && logs.length > 0 && (
        <View style={s.logBox}><Text style={s.logTitle}>Journal</Text>{logs.map((l, i) => <Text key={i} style={s.logLine} selectable>{l}</Text>)}</View>
      )}
    </BottomSheet>
  );
}

/* ---------------- SHARED ---------------- */

function BottomSheet({ children, title, onClose }: { children: React.ReactNode; title?: string; onClose?: () => void }) {
  const s = useStyles();
  const ty = useRef(new Animated.Value(60)).current;
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(ty, { toValue: 0, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(op, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, opacity: op }}><Pressable style={s.backdrop} onPress={onClose} /></Animated.View>
      <Animated.View style={[s.sheet, { transform: [{ translateY: ty }] }]}>
        <View style={s.sheetGrip} />
        {title && <Text style={s.sheetTitle}>{title}</Text>}
        {children}
      </Animated.View>
    </Modal>
  );
}

function SheetAction({ icon, tint, title, sub, danger, onPress }: { icon: FeatherName; tint: { bg: string; fg: string }; title: string; sub?: string; danger?: boolean; onPress: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  return (
    <Pressable style={({ pressed }) => [s.action, pressed && { backgroundColor: C.cardAlt }]} onPress={onPress} android_ripple={{ color: C.cardAlt }}>
      <View style={[s.actionTile, { backgroundColor: tint.bg }]}><Feather name={icon} size={18} color={tint.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.actionTxt, danger && { color: C.danger }]}>{title}</Text>
        {sub ? <Text style={s.actionSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function TextPrompt({ title, placeholder, initial, confirm, onCancel, onConfirm }: { title: string; placeholder?: string; initial?: string; confirm: string; onCancel: () => void; onConfirm: (v: string) => void }) {
  const { C } = useTheme(); const s = useStyles();
  const [v, setV] = useState(initial || "");
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={[s.fill, s.center, { backgroundColor: "rgba(0,0,0,0.5)", padding: 30 }]}>
        <View style={s.promptCard}>
          <Text style={s.promptTitle}>{title}</Text>
          <TextInput style={s.input} value={v} onChangeText={setV} placeholder={placeholder} placeholderTextColor={C.faint} autoFocus selectTextOnFocus />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <Pressable style={s.promptBtn} onPress={onCancel}><Text style={{ color: C.sub, fontWeight: "600" }}>Annuler</Text></Pressable>
            <Pressable style={[s.promptBtn, { backgroundColor: C.accent }]} onPress={() => v.trim() && onConfirm(v.trim())}><Text style={{ color: "#fff", fontWeight: "700" }}>{confirm}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- SETTINGS ---------------- */

function Settings({ cap, onClose, onLogout }: { cap: { total: number; used: number } | null; onClose: () => void; onLogout: () => void }) {
  const { C, mode, setMode } = useTheme(); const s = useStyles();
  const [me, setMe] = useState<Me>({ nickname: "", email: "" });
  const [cacheMsg, setCacheMsg] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  useEffect(() => { fetchMe().then(setMe).catch(() => {}); }, []);

  const ratio = cap && cap.total > 0 ? Math.min(1, cap.used / cap.total) : 0;
  const initials = (me.nickname || me.email || "?").trim().slice(0, 2).toUpperCase();
  const avatar = avatarUrl(me);

  async function clearCache() {
    try {
      await ExpoImage.clearMemoryCache(); await ExpoImage.clearDiskCache();
      const dir = FileSystem.cacheDirectory;
      if (dir) { const files = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]); for (const f of files) { try { await FileSystem.deleteAsync(dir + f, { idempotent: true }); } catch {} } }
      setCacheMsg("Vidé ✓");
    } catch { setCacheMsg("Erreur"); }
  }

  return (
    <Modal transparent={false} animationType="slide" visible onRequestClose={onClose}>
      <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
        <View style={s.header}>
          <IconBtn name="arrow-left" onPress={onClose} />
          <Text style={[s.headerTitle, { marginLeft: 8 }]}>Paramètres</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={s.setCard}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {avatar ? <ExpoImage source={{ uri: avatar, headers: authHeader() }} style={s.avatarImg} contentFit="cover" transition={200} cachePolicy="memory-disk" />
                : <View style={s.avatar}><Text style={s.avatarTxt}>{initials}</Text></View>}
              <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                <Text style={s.setName} numberOfLines={1}>{me.nickname || "Utilisateur"}</Text>
                <Text style={s.rowMeta} numberOfLines={1}>{me.email || "—"}</Text>
              </View>
            </View>
            <View style={s.setDivider} />
            <SetRow icon="server" label="Serveur" value={serverUrlValue().replace(/^https?:\/\//, "")} />
            <SetRow icon="hard-drive" label="Stockage" value={cap ? `${fmtSize(cap.used)} / ${fmtSize(cap.total)} (${Math.round(ratio * 100)}%)` : "…"} />
          </View>

          <Text style={s.setSection}>Apparence</Text>
          <View style={s.setCard}>
            <View style={s.segment}>
              {([["system", "Système", "smartphone"], ["light", "Clair", "sun"], ["dark", "Sombre", "moon"]] as [ThemeMode, string, FeatherName][]).map(([m, label, ic]) => {
                const active = mode === m;
                return (
                  <Pressable key={m} style={[s.segItem, active && s.segItemActive]} onPress={() => setMode(m)}>
                    <Feather name={ic} size={16} color={active ? "#fff" : C.sub} />
                    <Text style={[s.segTxt, active && { color: "#fff", fontWeight: "700" }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text style={s.setSection}>Compte</Text>
          <View style={s.setCard}>
            <Pressable style={({ pressed }) => [s.setAction, pressed && { backgroundColor: C.cardAlt }]} onPress={() => setPwOpen(true)}>
              <Feather name="lock" size={19} color={C.sub} style={{ width: 26 }} />
              <Text style={s.setActionTxt}>Changer le mot de passe</Text>
              <Feather name="chevron-right" size={18} color={C.faint} />
            </Pressable>
          </View>

          <Text style={s.setSection}>Application</Text>
          <View style={s.setCard}>
            <Pressable style={({ pressed }) => [s.setAction, pressed && { backgroundColor: C.cardAlt }]} onPress={clearCache}>
              <Feather name="trash" size={19} color={C.sub} style={{ width: 26 }} />
              <Text style={s.setActionTxt}>Vider le cache</Text>
              <Text style={s.rowMeta}>{cacheMsg}</Text>
            </Pressable>
            <View style={s.setDivider} />
            <View style={s.setAction}>
              <Feather name="info" size={19} color={C.sub} style={{ width: 26 }} />
              <Text style={s.setActionTxt}>Version</Text>
              <Text style={s.rowMeta}>Cloudreve App 1.0</Text>
            </View>
          </View>

          <Pressable style={({ pressed }) => [s.logoutBtn, pressed && { opacity: 0.85 }]} onPress={onLogout}>
            <Feather name="log-out" size={19} color={C.danger} />
            <Text style={s.logoutTxt}>Déconnexion</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </Modal>
  );
}

function SetRow({ icon, label, value }: { icon: FeatherName; label: string; value: string }) {
  const { C } = useTheme(); const s = useStyles();
  return (
    <View style={s.setAction}>
      <Feather name={icon} size={19} color={C.sub} style={{ width: 26 }} />
      <Text style={s.setActionTxt}>{label}</Text>
      <Text style={[s.rowMeta, { flexShrink: 1, textAlign: "right" }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (next.length < 6) return setErr("Le nouveau mot de passe doit faire au moins 6 caractères.");
    if (next !== conf) return setErr("Les deux nouveaux mots de passe ne correspondent pas.");
    setBusy(true);
    try { await changePassword(cur, next); Alert.alert("✓ Fait", "Mot de passe modifié."); onClose(); }
    catch (e: any) { setErr(e.message || "Échec (mot de passe actuel incorrect ?)"); }
    finally { setBusy(false); }
  }
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={[s.fill, s.center, { backgroundColor: "rgba(0,0,0,0.55)", padding: 26 }]}>
        <View style={s.promptCard}>
          <Text style={s.promptTitle}>Changer le mot de passe</Text>
          <View style={{ gap: 10 }}>
            <TextInput style={s.input} value={cur} onChangeText={setCur} placeholder="Mot de passe actuel" placeholderTextColor={C.faint} secureTextEntry autoFocus />
            <TextInput style={s.input} value={next} onChangeText={setNext} placeholder="Nouveau mot de passe" placeholderTextColor={C.faint} secureTextEntry />
            <TextInput style={s.input} value={conf} onChangeText={setConf} placeholder="Confirmer le nouveau" placeholderTextColor={C.faint} secureTextEntry />
          </View>
          {err ? <Text style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{err}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
            <Pressable style={s.promptBtn} onPress={onClose} disabled={busy}><Text style={{ color: C.sub, fontWeight: "600" }}>Annuler</Text></Pressable>
            <Pressable style={[s.promptBtn, { backgroundColor: C.accent, minWidth: 96, alignItems: "center" }]} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Valider</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- DRAWER ---------------- */

const DRAWER_W = 292;

function Drawer({ visible, activeUri, cap, onPick, onClose, onSettings }: { visible: boolean; activeUri: string; cap: { total: number; used: number } | null; onPick: (sc: { name: string; uri: string }) => void; onClose: () => void; onSettings: () => void }) {
  const { C } = useTheme(); const s = useStyles();
  const [mounted, setMounted] = useState(visible);
  const tx = useRef(new Animated.Value(-DRAWER_W)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const ratio = cap && cap.total > 0 ? Math.min(1, cap.used / cap.total) : 0;
  const pct = Math.round(ratio * 100);
  const nearFull = ratio > 0.9;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 240, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(dim, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
      Animated.timing(bar, { toValue: ratio, duration: 650, delay: 130, useNativeDriver: false, easing: Easing.out(Easing.cubic) }).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(tx, { toValue: -DRAWER_W, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
        Animated.timing(dim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, ratio]);

  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Animated.View style={{ width: DRAWER_W, height: "100%", transform: [{ translateX: tx }] }}>
          <SafeAreaView style={s.drawer}>
            <View style={s.drawerHead}>
              <Feather name="cloud" size={24} color={C.accent} />
              <Text style={s.drawerLogo}>Cloudreve</Text>
            </View>
            <View style={{ flex: 1, paddingTop: 4 }}>
              {SHORTCUTS.map((sc) => {
                const active = sc.uri === activeUri;
                return (
                  <Pressable key={sc.uri} style={({ pressed }) => [s.drawerItem, active && s.drawerItemActive, pressed && { opacity: 0.6 }]} onPress={() => onPick(sc)} android_ripple={{ color: C.cardAlt }}>
                    <Feather name={sc.icon} size={19} color={active ? C.accent : C.sub} style={{ width: 24, textAlign: "center" }} />
                    <Text style={[s.drawerLabel, active && { color: C.accent, fontWeight: "700" }]}>{sc.name}</Text>
                  </Pressable>
                );
              })}
              <View style={{ height: 1, backgroundColor: C.border, marginVertical: 8, marginHorizontal: 16 }} />
              <Pressable style={({ pressed }) => [s.drawerItem, pressed && { opacity: 0.6 }]} onPress={onSettings} android_ripple={{ color: C.cardAlt }}>
                <Feather name="settings" size={19} color={C.sub} style={{ width: 24, textAlign: "center" }} />
                <Text style={s.drawerLabel}>Paramètres</Text>
              </Pressable>
            </View>
            <Pressable onPress={onSettings} style={({ pressed }) => [s.storageBox, pressed && { opacity: 0.85 }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 9 }}>
                <Text style={s.storageTitle}>Stockage</Text>
                <Text style={[s.storageTitle, { color: C.sub, fontWeight: "500" }]}>{pct}%</Text>
              </View>
              <View style={s.storageTrack}>
                <Animated.View style={[s.storageFill, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }), backgroundColor: nearFull ? C.danger : C.accent }]} />
              </View>
              <Text style={s.storageTxt}>{cap ? `${fmtSize(cap.used)} sur ${fmtSize(cap.total)}` : "…"}</Text>
            </Pressable>
          </SafeAreaView>
        </Animated.View>
        <Animated.View style={{ flex: 1, opacity: dim }}><Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} /></Animated.View>
      </View>
    </Modal>
  );
}

/* ---------------- STYLES (factory) ---------------- */

function makeStyles(C: Palette) {
  return StyleSheet.create({
    fill: { flex: 1 },
    center: { alignItems: "center", justifyContent: "center" },

    loginLogo: { width: 84, height: 84, borderRadius: 22, backgroundColor: C.card, alignItems: "center", justifyContent: "center", marginBottom: 18, borderWidth: 1, borderColor: C.border },
    logo: { color: C.text, fontSize: 30, fontWeight: "800" },
    logoSub: { color: C.sub, fontSize: 14, marginTop: 6 },
    label: { color: C.sub, fontSize: 13, marginBottom: 6, marginLeft: 2 },
    input: { backgroundColor: C.dark ? C.card : C.bg2, borderColor: C.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 16 },
    btn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15, alignItems: "center", width: "100%", marginTop: 8 },
    btnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },

    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, height: 56, borderBottomColor: C.border, borderBottomWidth: 1, backgroundColor: C.bg2 },
    headerTitle: { color: C.text, fontSize: 20, fontWeight: "700", flex: 1, marginLeft: 4 },
    iconBtn: { paddingHorizontal: 8, paddingVertical: 6 },
    searchInput: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 4, marginLeft: 4 },

    crumbs: { maxHeight: 46, borderBottomColor: C.border, borderBottomWidth: 1, paddingLeft: 12, backgroundColor: C.bg2 },
    crumbSep: { color: C.faint, fontSize: 16, marginHorizontal: 3 },
    crumbChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8, maxWidth: 170 },
    crumbChipActive: { backgroundColor: C.accentDim },
    crumbTxt: { color: C.sub, fontSize: 13.5 },
    crumbTxtActive: { color: C.accent, fontWeight: "700" },

    row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9 },
    thumbBox: { width: 46, height: 46, borderRadius: 11, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    thumb: { width: 46, height: 46, borderRadius: 11 },
    rowName: { color: C.text, fontSize: 15.5, fontWeight: "500" },
    rowMeta: { color: C.sub, fontSize: 12.5, marginTop: 3 },
    moreBtn: { paddingHorizontal: 8, paddingVertical: 6 },

    fabWrap: { position: "absolute", right: 20, bottom: 26, borderRadius: 30, overflow: "hidden", elevation: 8, shadowColor: C.accent, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    fab: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },

    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: C.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 14, paddingBottom: 34, paddingTop: 8, borderTopColor: C.border, borderTopWidth: 1 },
    sheetGrip: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 12 },
    sheetTitle: { color: C.sub, fontSize: 13, fontWeight: "600", marginBottom: 6, marginLeft: 6 },
    sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: 10, paddingHorizontal: 4 },
    sheetName: { color: C.text, fontSize: 16, fontWeight: "600" },

    action: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 11, paddingHorizontal: 6, borderRadius: 12 },
    actionTile: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    actionTxt: { color: C.text, fontSize: 16, fontWeight: "600" },
    actionSub: { color: C.sub, fontSize: 12.5, marginTop: 2 },

    progTrack: { height: 5, borderRadius: 3, backgroundColor: C.border, width: 210, marginTop: 12, overflow: "hidden" },
    progFill: { height: 5, backgroundColor: C.accent, borderRadius: 3 },

    upCard: { backgroundColor: C.bg2, borderRadius: 18, padding: 26, width: 264, alignItems: "center", borderWidth: 1, borderColor: C.border },
    upTitle: { color: C.text, fontSize: 15, fontWeight: "700", marginTop: 14 },
    upName: { color: C.sub, fontSize: 13, marginTop: 4, marginBottom: 12, maxWidth: 210 },

    promptCard: { width: "100%", maxWidth: 380, backgroundColor: C.bg2, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: C.border },
    promptTitle: { color: C.text, fontSize: 17, fontWeight: "700", marginBottom: 14 },
    promptBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },

    logBox: { width: "100%", marginTop: 16, backgroundColor: C.dark ? "#080b11" : "#eef1f5", borderRadius: 10, borderColor: C.border, borderWidth: 1, padding: 10 },
    logTitle: { color: C.sub, fontSize: 11, fontWeight: "700", marginBottom: 6, textTransform: "uppercase" },
    logLine: { color: C.green, fontSize: 11, fontFamily: "monospace", marginBottom: 1 },

    setCard: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
    avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentDim, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.accent },
    avatarImg: { width: 52, height: 52, borderRadius: 26 },
    avatarTxt: { color: C.accent, fontSize: 19, fontWeight: "800" },
    setName: { color: C.text, fontSize: 17, fontWeight: "700" },
    setDivider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
    setSection: { color: C.sub, fontSize: 12.5, fontWeight: "700", textTransform: "uppercase", marginTop: 14, marginBottom: 8, marginLeft: 6 },
    setAction: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderRadius: 8 },
    setActionTxt: { color: C.text, fontSize: 15.5, flex: 1 },
    segment: { flexDirection: "row", backgroundColor: C.cardAlt, borderRadius: 11, padding: 4, gap: 4 },
    segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, borderRadius: 8 },
    segItemActive: { backgroundColor: C.accent },
    segTxt: { color: C.sub, fontSize: 14, fontWeight: "600" },
    logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 20, paddingVertical: 15, borderRadius: 12, borderWidth: 1, borderColor: C.danger + "55" },
    logoutTxt: { color: C.danger, fontSize: 16, fontWeight: "700" },

    drawer: { flex: 1, width: DRAWER_W, backgroundColor: C.bg2, paddingTop: 8, borderRightColor: C.border, borderRightWidth: 1 },
    drawerHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 16 },
    drawerLogo: { color: C.text, fontSize: 21, fontWeight: "800" },
    drawerItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, paddingHorizontal: 14, marginHorizontal: 8, borderRadius: 11 },
    drawerItemActive: { backgroundColor: C.accentDim },
    drawerLabel: { color: C.text, fontSize: 15.5 },
    storageBox: { backgroundColor: C.card, margin: 12, borderRadius: 14, padding: 15, borderWidth: 1, borderColor: C.border },
    storageTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
    storageTrack: { height: 7, borderRadius: 4, backgroundColor: C.border, overflow: "hidden" },
    storageFill: { height: 7, borderRadius: 4 },
    storageTxt: { color: C.sub, fontSize: 12.5, marginTop: 8 },
  });
}
