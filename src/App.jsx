import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  Book,
  Plus,
  Trash2,
  Edit2,
  Play,
  LogIn,
  LogOut,
  Crown,
  X,
  Check,
  AlertCircle,
  Zap,
  Menu,
  Infinity,
  FolderOpen,
} from 'lucide-react';
import { supabase } from './supabaseClient';

// Authentication Context
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 2025 წლის სწორი ლოკალური JWT decode (მუშაობს v2.39+)
  const getUserFromLocalStorage = () => {
    try {
      const sessionData = localStorage.getItem('supabase.auth.token');
      if (!sessionData) return null;

      const { currentSession } = JSON.parse(sessionData);
      if (!currentSession?.access_token) return null;

      const payload = JSON.parse(
        atob(currentSession.access_token.split('.')[1])
      );

      // თუ ტოკენი გასულია ვადა
      if (payload.exp * 1000 < Date.now()) return null;

      return {
        id: payload.sub,
        email: payload.email,
      };
    } catch (err) {
      return null;
    }
  };

  const loadUserProfile = async (authUser) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (profile) {
        setUser({
          id: authUser.id,
          email: profile.email || authUser.email,
          isSubscribed: !!profile.is_subscribed,
          subscriptionExpiry: profile.subscription_expiry,
        });
      } else {
        setUser({
          id: authUser.id,
          email: authUser.email,
          isSubscribed: false,
          subscriptionExpiry: null,
        });

        await supabase.from('profiles').upsert(
          {
            id: authUser.id,
            email: authUser.email,
            is_subscribed: false,
            subscription_expiry: null,
          },
          { onConflict: 'id' }
        );
      }
    } catch (err) {
      console.error('Profile load error:', err);
      setUser({
        id: authUser.id,
        email: authUser.email,
        isSubscribed: false,
        subscriptionExpiry: null,
      });
    }
  };

  useEffect(() => {
    let authSubscription = null;

    const initAuth = async () => {
      // 1. მყისიერი ლოკალური JWT (30–80 ms საქართველოდან)
      const localUser = getUserFromLocalStorage();
      if (localUser) {
        await loadUserProfile(localUser);
        setLoading(false);
        console.log('User loaded instantly from localStorage');
      }

      // 2. Fallback – სერვერიდან განახლება (თუ ტოკენი expired ან არ არსებობს)
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          await loadUserProfile(session.user);
        } else if (!localUser) {
          setUser(null);
        }
      } catch (err) {
        console.warn('getSession failed:', err);
        if (!localUser) setUser(null);
      } finally {
        setLoading(false);
      }

      // 3. მოვუსმინოთ ცვლილებებს
      const { data: listener } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (event === 'SIGNED_OUT' || !session?.user) {
            setUser(null);
            return;
          }
          if (session?.user) {
            await loadUserProfile(session.user);
          }
        }
      );

      authSubscription = listener.subscription;
    };

    initAuth();

    return () => {
      authSubscription?.unsubscribe?.();
    };
  }, []);

  const login = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Login failed' };
    }
  };

  const register = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data?.user && !data.session) {
        return {
          success: true,
          message: 'Check your email to confirm registration',
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Registration failed' };
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      // 👇 Force reload to clear any stuck state
      window.location.href = '/';
    }
  };

  // AuthProvider-ში
  const subscribe = async (plan = 'yearly') => {
    if (!user) return;

    const days = plan === 'monthly' ? 30 : 365;
    const expiry = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000
    ).toISOString();

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_subscribed: true,
          subscription_expiry: expiry,
          subscription_type: plan, // აუცილებელია
        })
        .eq('id', user.id);

      if (error) throw error;

      // სწრაფად განვაახლოთ user state
      setUser((prev) => ({
        ...prev,
        isSubscribed: true,
        subscriptionExpiry: expiry,
      }));
    } catch (err) {
      console.error('Subscribe error:', err);
      throw err; // მნიშვნელოვანია, რომ handleSubscribe-მა დაინახოს
    }
  };

  const unsubscribe = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_subscribed: false,
          subscription_expiry: null,
        })
        .eq('id', user.id);

      if (!error) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          await loadUserProfile(session.user); // ← აუცილებელია!
        }
      }
    } catch (err) {
      console.error('Unsubscribe error:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, login, register, logout, subscribe, unsubscribe, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext);

// Main App Component
const VocabApp = () => {
  const { user, loading } = useAuth();
  const [currentView, setCurrentView] = useState('words');
  const [guestWords, setGuestWords] = useState([]);
  const [words, setWords] = useState([]);
  const [catalogs, setCatalogs] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });

  useEffect(() => {
    if (user && user.isSubscribed) {
      loadUserData();
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode);
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const loadUserData = async () => {
    if (!user || !user.isSubscribed) return;

    setLoadingData(true);

    // Load Words
    const { data: wordsData, error: wordsError } = await supabase
      .from('words')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!wordsError && wordsData) {
      setWords(wordsData);
    }

    // Load Catalogs
    const { data: catalogsData, error: catalogsError } = await supabase
      .from('catalogs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!catalogsError && catalogsData) {
      setCatalogs(catalogsData);
    }

    setLoadingData(false);
  };

  const addWord = async (english, georgian, catalogId = null) => {
    if (user && user.isSubscribed) {
      const { data, error } = await supabase
        .from('words')
        .insert([
          {
            user_id: user.id,
            english,
            georgian,
            catalog_id: catalogId,
          },
        ])
        .select()
        .single();

      if (!error && data) {
        setWords([data, ...words]);
        return { success: true };
      }
      return { success: false, error: error?.message || 'Failed to add word' };
    } else {
      // Guest logic remains the same
      if (guestWords.length >= 30) {
        return { success: false, error: 'Guest limit reached (30 words)' };
      }
      const newWord = {
        id: Date.now().toString(),
        english,
        georgian,
        catalogId,
        createdAt: new Date().toISOString(),
      };
      setGuestWords([...guestWords, newWord]);
      return { success: true };
    }
  };

  const deleteWord = async (wordId) => {
    if (user && user.isSubscribed) {
      const { error } = await supabase.from('words').delete().eq('id', wordId);

      if (!error) {
        setWords(words.filter((w) => w.id !== wordId));
      }
    } else {
      setGuestWords(guestWords.filter((w) => w.id !== wordId));
    }
  };

  const updateWord = async (wordId, english, georgian, catalogId) => {
    if (user && user.isSubscribed) {
      const { data, error } = await supabase
        .from('words')
        .update({ english, georgian, catalog_id: catalogId })
        .eq('id', wordId)
        .select()
        .single();

      if (!error && data) {
        setWords(words.map((w) => (w.id === wordId ? data : w)));
      }
    } else {
      setGuestWords(
        guestWords.map((w) =>
          w.id === wordId ? { ...w, english, georgian } : w
        )
      );
    }
  };

  const addCatalog = async (name, color) => {
    if (!user || !user.isSubscribed) return;

    const { data, error } = await supabase
      .from('catalogs')
      .insert([
        {
          user_id: user.id,
          name,
          color,
        },
      ])
      .select()
      .single();

    if (!error && data) {
      setCatalogs([data, ...catalogs]);
    }
  };

  const deleteCatalog = async (catalogId) => {
    if (!user || !user.isSubscribed) return;

    const { error } = await supabase
      .from('catalogs')
      .delete()
      .eq('id', catalogId);

    if (!error) {
      setCatalogs(catalogs.filter((c) => c.id !== catalogId));

      // Update words to remove catalog reference
      const { error: updateError } = await supabase
        .from('words')
        .update({ catalog_id: null })
        .eq('catalog_id', catalogId);

      if (!updateError) {
        setWords(
          words.map((w) =>
            w.catalog_id === catalogId ? { ...w, catalog_id: null } : w
          )
        );
      }
    }
  };

  const deleteAllWords = async () => {
    if (user && user.isSubscribed) {
      const { error } = await supabase
        .from('words')
        .delete()
        .eq('user_id', user.id);

      if (!error) {
        setWords([]);
      }
    } else {
      setGuestWords([]);
    }
  };

  const deleteWordsByCatalog = async (catalogId) => {
    if (!user || !user.isSubscribed) return;

    const { error } = await supabase
      .from('words')
      .delete()
      .eq('catalog_id', catalogId);

    if (!error) {
      setWords(words.filter((w) => w.catalog_id !== catalogId));
    }
  };

  const activeWords = user && user.isSubscribed ? words : guestWords;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        darkMode
          ? 'bg-gradient-to-br from-gray-900 to-gray-800'
          : 'bg-gradient-to-br from-blue-50 to-indigo-100'
      }`}
    >
      <Header
        currentView={currentView}
        setCurrentView={setCurrentView}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
      />

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {!user && <GuestBanner wordCount={guestWords.length} />}
        {user && !user.isSubscribed && <SubscriptionBanner />}

        {currentView === 'words' && (
          <WordsView
            words={activeWords}
            catalogs={catalogs}
            onAddWord={addWord}
            onDeleteWord={deleteWord}
            onUpdateWord={updateWord}
            onDeleteAll={deleteAllWords}
            onDeleteByCatalog={deleteWordsByCatalog}
            isGuest={!user || !user.isSubscribed}
            guestLimit={30}
          />
        )}

        {currentView === 'catalogs' && (
          <CatalogsView
            catalogs={catalogs}
            words={words}
            onAddCatalog={addCatalog}
            onDeleteCatalog={deleteCatalog}
            isSubscribed={user && user.isSubscribed}
          />
        )}

        {currentView === 'practice' && (
          <PracticeView words={activeWords} catalogs={catalogs} />
        )}

        {currentView === 'auth' && <AuthView setCurrentView={setCurrentView} />}

        {currentView === 'subscription' && <SubscriptionView />}

        {currentView === 'about' && <AboutView />}

        {currentView === 'contact' && <ContactView />}
      </main>
    </div>
  );
};

// Header Component
const Header = ({ currentView, setCurrentView, darkMode, setDarkMode }) => {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { name: 'My Words', view: 'words' },
    { name: 'Practice', view: 'practice', icon: <Play className="w-4 h-4" /> },
    ...(user?.isSubscribed ? [{ name: 'Catalogs', view: 'catalogs' }] : []),
    ...(user?.isSubscribed ? [{ name: 'Account', view: 'subscription' }] : []),
    { name: 'About', view: 'about' },
    { name: 'Contact', view: 'contact' },
  ];

  return (
    <header
      className={`shadow-md transition-colors duration-300 ${
        darkMode ? 'bg-gray-800' : 'bg-white'
      } sticky top-0 z-40`}
    >
      <div className="container mx-auto px-4 py-4 max-w-6xl">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center space-x-3">
            <Book
              className={`w-8 h-8 ${
                darkMode ? 'text-indigo-400' : 'text-indigo-600'
              }`}
            />
            <h1
              className={`text-2xl font-bold ${
                darkMode ? 'text-white' : 'text-gray-800'
              }`}
            >
              VocabMaster
            </h1>
            {user?.isSubscribed && (
              <Crown className="w-5 h-5 text-yellow-500" />
            )}
          </div>

          {/* Desktop Menu */}
          <nav className="hidden md:flex items-center space-x-2">
            {navItems.map((item) => (
              <button
                key={item.view}
                onClick={() => setCurrentView(item.view)}
                className={`px-4 py-2 rounded-lg transition text-sm font-medium flex items-center space-x-1 ${
                  currentView === item.view
                    ? 'bg-indigo-600 text-white'
                    : darkMode
                    ? 'text-gray-300 hover:bg-gray-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.icon && item.icon}
                <span>{item.name}</span>
              </button>
            ))}

            {/* Dark Mode + Auth */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-lg transition ${
                darkMode
                  ? 'bg-gray-700 text-yellow-400'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {darkMode ? (
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>

            {user ? (
              <div className="flex items-center space-x-3">
                {!user.isSubscribed && (
                  <button
                    onClick={() => setCurrentView('subscription')}
                    className="px-5 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 font-bold"
                  >
                    Upgrade
                  </button>
                )}
                <button
                  onClick={logout}
                  className="p-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCurrentView('auth')}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center space-x-2 font-medium"
              >
                <LogIn className="w-5 h-5" />
                <span>Login</span>
              </button>
            )}
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`md:hidden p-2 rounded-lg ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div
            className={`md:hidden mt-4 pb-4 border-t ${
              darkMode ? 'border-gray-700' : 'border-gray-200'
            }`}
          >
            <nav className="flex flex-col space-y-2 mt-4">
              {navItems.map((item) => (
                <button
                  key={item.view}
                  onClick={() => {
                    setCurrentView(item.view);
                    setMobileMenuOpen(false);
                  }}
                  className={`px-4 py-3 rounded-lg text-left flex items-center space-x-2 ${
                    currentView === item.view
                      ? 'bg-indigo-600 text-white'
                      : darkMode
                      ? 'text-gray-300 hover:bg-gray-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {item.icon && item.icon}
                  <span className="font-medium">{item.name}</span>
                </button>
              ))}

              {/* Mobile Auth Section */}
              <div className="pt-4 border-t border-gray-300 mt-4">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-600">Dark Mode</span>
                  <button
                    onClick={() => setDarkMode(!darkMode)}
                    className={`p-2 rounded-lg ${
                      darkMode ? 'bg-gray-700 text-yellow-400' : 'bg-gray-200'
                    }`}
                  >
                    {darkMode ? 'Sun' : 'Moon'}
                  </button>
                </div>

                {user ? (
                  <>
                    {!user.isSubscribed && (
                      <button
                        onClick={() => {
                          setCurrentView('subscription');
                          setMobileMenuOpen(false);
                        }}
                        className="w-full px-4 py-3 bg-yellow-500 text-white rounded-lg font-bold text-left mt-2"
                      >
                        Upgrade to Premium
                      </button>
                    )}
                    <button
                      onClick={() => {
                        logout();
                        setMobileMenuOpen(false);
                      }}
                      className="w-full px-4 py-3 text-red-600 font-medium text-left mt-2"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setCurrentView('auth');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg font-bold text-left mt-2"
                  >
                    Login / Register
                  </button>
                )}
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};

// Guest Banner
const GuestBanner = ({ wordCount }) => (
  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6 rounded-lg">
    <div className="flex items-start">
      <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
      <div className="flex-1">
        <h3 className="font-semibold text-yellow-800">
          Guest Mode - Limited Access
        </h3>
        <p className="text-sm text-yellow-700 mt-1">
          You're using {wordCount}/30 words. Words will disappear when you close
          the page. Register to save unlimited words permanently!
        </p>
      </div>
    </div>
  </div>
);

// Subscription Banner
const SubscriptionBanner = () => (
  <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-l-4 border-purple-400 p-4 mb-6 rounded-lg">
    <div className="flex items-start">
      <Crown className="w-5 h-5 text-purple-600 mt-0.5 mr-3 flex-shrink-0" />
      <div className="flex-1">
        <h3 className="font-semibold text-purple-800">
          Unlock Premium Features
        </h3>
        <p className="text-sm text-purple-700 mt-1">
          Subscribe to get unlimited words, catalog organization, and persistent
          storage across all devices!
        </p>
      </div>
    </div>
  </div>
);

// Words View
const WordsView = ({
  words,
  catalogs,
  onAddWord,
  onDeleteWord,
  onUpdateWord,
  onDeleteAll,
  onDeleteByCatalog,
  isGuest,
  guestLimit,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingWord, setEditingWord] = useState(null);
  const [english, setEnglish] = useState('');
  const [georgian, setGeorgian] = useState('');
  const [selectedCatalog, setSelectedCatalog] = useState('');
  const [error, setError] = useState('');
  const [filterCatalog, setFilterCatalog] = useState('all');
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showDeleteCatalogConfirm, setShowDeleteCatalogConfirm] =
    useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!english.trim() || !georgian.trim()) {
      setError('Both fields are required');
      return;
    }

    if (editingWord) {
      await onUpdateWord(
        editingWord.id,
        english,
        georgian,
        selectedCatalog || null
      );
      setEditingWord(null);
    } else {
      const result = await onAddWord(
        english,
        georgian,
        selectedCatalog || null
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
    }

    setEnglish('');
    setGeorgian('');
    setSelectedCatalog('');
    setShowAddForm(false);
  };

  const handleEdit = (word) => {
    setEditingWord(word);
    setEnglish(word.english);
    setGeorgian(word.georgian);
    setSelectedCatalog(word.catalog_id || '');
    setShowAddForm(true);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingWord(null);
    setEnglish('');
    setGeorgian('');
    setSelectedCatalog('');
    setError('');
  };

  const handleDeleteAll = () => {
    onDeleteAll();
    setShowDeleteAllConfirm(false);
    setFilterCatalog('all');
  };

  const handleDeleteByCatalog = () => {
    onDeleteByCatalog(filterCatalog);
    setShowDeleteCatalogConfirm(false);
    setFilterCatalog('all');
  };

  const filteredWords =
    filterCatalog === 'all'
      ? words
      : filterCatalog === 'uncategorized'
      ? words.filter((w) => !w.catalog_id)
      : words.filter((w) => w.catalog_id === filterCatalog);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">My Vocabulary</h2>
            <p className="text-gray-600 mt-1">
              {isGuest
                ? `${words.length}/${guestLimit} words`
                : `${words.length} words saved`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {words.length > 0 && (
              <button
                onClick={() => setShowDeleteAllConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center space-x-2 text-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete All</span>
              </button>
            )}
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              disabled={isGuest && words.length >= guestLimit}
              className="px-4 md:px-6 py-2 md:py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2 text-sm md:text-base"
            >
              <Plus className="w-4 h-4 md:w-5 md:h-5" />
              <span>Add Word</span>
            </button>
          </div>
        </div>

        {!isGuest && catalogs.length > 0 && (
          <div className="mb-4 flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by catalog:
              </label>
              <select
                value={filterCatalog}
                onChange={(e) => setFilterCatalog(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="all">All Words</option>
                <option value="uncategorized">Uncategorized</option>
                {catalogs.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            {filterCatalog !== 'all' && filteredWords.length > 0 && (
              <button
                onClick={() => setShowDeleteCatalogConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center space-x-2 text-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete from Catalog</span>
              </button>
            )}
          </div>
        )}

        {showAddForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-gray-50 p-4 rounded-lg mb-6"
          >
            <h3 className="font-semibold text-gray-800 mb-4">
              {editingWord ? 'Edit Word' : 'Add New Word'}
            </h3>

            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  English Word
                </label>
                <input
                  type="text"
                  value={english}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Only allow English letters and spaces
                    if (/^[a-zA-Z\s]*$/.test(value)) {
                      setEnglish(value);
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g., Hello"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Georgian Translation
                </label>
                <input
                  type="text"
                  value={georgian}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Only allow Georgian letters and spaces
                    if (/^[ა-ჰ\s]*$/.test(value)) {
                      setGeorgian(value);
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g., გამარჯობა"
                />
              </div>
            </div>

            {!isGuest && catalogs.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Catalog (Optional)
                </label>
                <select
                  value={selectedCatalog}
                  onChange={(e) => setSelectedCatalog(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">No Catalog</option>
                  {catalogs.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex space-x-3">
              <button
                type="submit"
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                {editingWord ? 'Update' : 'Add'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredWords.length === 0 ? (
          <div className="col-span-2 text-center py-12 bg-white rounded-xl shadow-md">
            <Book className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">
              No words yet. Start adding vocabulary!
            </p>
          </div>
        ) : (
          filteredWords.map((word) => {
            const catalog = catalogs.find((c) => c.id === word.catalog_id);
            return (
              <div
                key={word.id}
                className="bg-white rounded-lg shadow-md p-5 hover:shadow-lg transition"
              >
                {catalog && (
                  <span
                    className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-2"
                    style={{
                      backgroundColor: catalog.color + '20',
                      color: catalog.color,
                    }}
                  >
                    {catalog.name}
                  </span>
                )}
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-lg font-semibold text-gray-800">
                      {word.english}
                    </p>
                    <p className="text-xl text-indigo-600 mt-1">
                      {word.georgian}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(word)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteWord(word.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {/* Delete All Confirmation Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800">
                Delete All Words?
              </h3>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete all {words.length} words? This
              action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleDeleteAll}
                className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold"
              >
                Yes, Delete All
              </button>
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete by Catalog Confirmation Modal */}
      {showDeleteCatalogConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800">
                Delete Catalog Words?
              </h3>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete all {filteredWords.length} words
              from this catalog? This action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleDeleteByCatalog}
                className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setShowDeleteCatalogConfirm(false)}
                className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Catalogs View
const CatalogsView = ({
  catalogs,
  words,
  onAddCatalog,
  onDeleteCatalog,
  isSubscribed,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');

  const colors = [
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f59e0b',
    '#10b981',
    '#06b6d4',
    '#ef4444',
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAddCatalog(name, color);
    setName('');
    setColor('#6366f1');
    setShowAddForm(false);
  };

  if (!isSubscribed) {
    return (
      <div className="bg-white rounded-xl shadow-md p-12 text-center">
        <Crown className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          Premium Feature
        </h2>
        <p className="text-gray-600 mb-6">
          Catalogs are available for subscribed users. Organize your vocabulary
          into custom categories!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">My Catalogs</h2>
            <p className="text-gray-600 mt-1">
              {catalogs.length} catalogs created
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 md:px-6 py-2 md:py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>New Catalog</span>
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-gray-50 p-4 rounded-lg mb-6"
          >
            <h3 className="font-semibold text-gray-800 mb-4">
              Create New Catalog
            </h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Catalog Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="e.g., Business Terms, Daily Phrases"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color
              </label>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-10 h-10 rounded-lg transition ${
                      color === c ? 'ring-4 ring-gray-400 ring-offset-2' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                type="submit"
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {catalogs.length === 0 ? (
          <div className="col-span-3 text-center py-12 bg-white rounded-xl shadow-md">
            <Book className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">
              No catalogs yet. Create one to organize your words!
            </p>
          </div>
        ) : (
          catalogs.map((catalog) => {
            const wordCount = words.filter(
              (w) => w.catalog_id === catalog.id
            ).length;
            return (
              <div
                key={catalog.id}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition"
                style={{ borderTop: `4px solid ${catalog.color}` }}
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-gray-800">
                    {catalog.name}
                  </h3>
                  <button
                    onClick={() => onDeleteCatalog(catalog.id)}
                    className="p-1 text-red-600 hover:bg-red-50 rounded transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-gray-600">{wordCount} words</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// Practice View
// Practice View — ახალი ვერსია (ორი მიმართულებით)
const PracticeView = ({ words, catalogs }) => {
  const [selectedCatalog, setSelectedCatalog] = useState('all');
  const [practiceDirection, setPracticeDirection] = useState('en-to-ka'); // ახალი: მიმართულება
  const [isActive, setIsActive] = useState(false);
  const [currentWord, setCurrentWord] = useState(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [usedWords, setUsedWords] = useState([]);

  const practiceWords =
    selectedCatalog === 'all'
      ? words
      : selectedCatalog === 'uncategorized'
      ? words.filter((w) => !w.catalog_id)
      : words.filter((w) => w.catalog_id === selectedCatalog);

  const getRandomWord = () => {
    const availableWords = practiceWords.filter(
      (w) => !usedWords.includes(w.id)
    );
    if (availableWords.length === 0) {
      setUsedWords([]);
      return practiceWords[Math.floor(Math.random() * practiceWords.length)];
    }
    const randomIndex = Math.floor(Math.random() * availableWords.length);
    const word = availableWords[randomIndex];
    setUsedWords([...usedWords, word.id]);
    return word;
  };

  const startPractice = () => {
    if (practiceWords.length === 0) return;
    setIsActive(true);
    setScore({ correct: 0, total: 0 });
    setUsedWords([]);
    setFeedback(null);
    setAnswer('');
    const word = getRandomWord();
    setCurrentWord(word);
  };

  const checkAnswer = () => {
    if (!answer.trim() || !currentWord) return;

    const correctAnswer =
      practiceDirection === 'en-to-ka'
        ? currentWord.georgian.toLowerCase()
        : currentWord.english.toLowerCase();

    const isCorrect = answer.trim().toLowerCase() === correctAnswer;

    setScore((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
    }));
    setFeedback(isCorrect ? 'correct' : 'incorrect');
  };

  const goToNextWord = () => {
    setAnswer('');
    setFeedback(null);
    const nextWord = getRandomWord();
    if (nextWord) {
      setCurrentWord(nextWord);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && answer.trim() && !feedback) {
      checkAnswer();
    }
  };

  const endPractice = () => {
    setIsActive(false);
    setCurrentWord(null);
    setAnswer('');
    setFeedback(null);
    setUsedWords([]);
  };

  if (words.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-md p-12 text-center">
        <Book className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">No Words Yet</h2>
        <p className="text-gray-600">
          Add some words first to start practicing!
        </p>
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="bg-white rounded-xl shadow-md p-8 max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold text-gray-800 mb-8 text-center">
          Practice Mode
        </h2>

        {/* მიმართულების არჩევა */}
        <div className="mb-8">
          <label className="block text-lg font-semibold text-gray-700 mb-4 text-center">
            Choose Practice Direction:
          </label>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setPracticeDirection('en-to-ka')}
              className={`px-8 py-4 rounded-xl font-bold text-lg transition ${
                practiceDirection === 'en-to-ka'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              English → Georgian
            </button>
            <button
              onClick={() => setPracticeDirection('ka-to-en')}
              className={`px-8 py-4 rounded-xl font-bold text-lg transition ${
                practiceDirection === 'ka-to-en'
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              Georgian → English
            </button>
          </div>
        </div>

        {/* კატალოგის არჩევა */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Catalog:
          </label>
          <select
            value={selectedCatalog}
            onChange={(e) => setSelectedCatalog(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Words ({words.length})</option>
            <option value="uncategorized">
              Uncategorized ({words.filter((w) => !w.catalog_id).length})
            </option>
            {catalogs.map((cat) => {
              const count = words.filter((w) => w.catalog_id === cat.id).length;
              return (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({count})
                </option>
              );
            })}
          </select>
        </div>

        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-6 rounded-xl mb-8 text-center">
          <p className="text-lg font-medium text-gray-800">
            {practiceDirection === 'en-to-ka'
              ? 'You will see English words → type Georgian'
              : 'You will see Georgian words → type English'}
          </p>
        </div>

        <button
          onClick={startPractice}
          disabled={practiceWords.length === 0}
          className="w-full py-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-2xl font-bold rounded-xl hover:from-indigo-700 hover:to-purple-700 transition shadow-xl disabled:opacity-50"
        >
          Start Practice
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-8 max-w-2xl mx-auto">
      {/* ქულები */}
      <div className="flex justify-between items-center mb-8 bg-gray-50 rounded-xl p-6">
        <div className="text-center flex-1">
          <p className="text-sm text-gray-600">Correct</p>
          <p className="text-4xl font-bold text-green-600">{score.correct}</p>
        </div>
        <div className="text-center flex-1">
          <p className="text-sm text-gray-600">Total</p>
          <p className="text-4xl font-bold text-gray-800">{score.total}</p>
        </div>
        <div className="text-center flex-1">
          <p className="text-sm text-gray-600">Accuracy</p>
          <p className="text-4xl font-bold text-indigo-600">
            {score.total > 0
              ? Math.round((score.correct / score.total) * 100)
              : 0}
            %
          </p>
        </div>
      </div>

      {/* სიტყვა */}
      {currentWord && (
        <div className="text-center mb-10">
          <p className="text-sm text-gray-500 mb-4">
            Type the translation in{' '}
            <strong>
              {practiceDirection === 'en-to-ka' ? 'Georgian' : 'English'}
            </strong>
          </p>
          <h3 className="text-6xl font-bold text-indigo-600 break-words">
            {practiceDirection === 'en-to-ka'
              ? currentWord.english
              : currentWord.georgian}
          </h3>
        </div>
      )}

      {/* პასუხი */}
      <div className="space-y-6">
        <input
          type="text"
          value={answer}
          onChange={(e) => {
            let value = e.target.value;

            if (practiceDirection === 'en-to-ka') {
              // მხოლოდ ქართული ასოები + სივრცე
              if (/^[\u10A0-\u10FF\s]*$/.test(value)) {
                setAnswer(value);
              }
            } else {
              // მხოლოდ ინგლისური ასოები + სივრცე
              if (/^[a-zA-Z\s]*$/.test(value)) {
                setAnswer(value);
              }
            }
          }}
          onKeyDown={handleKeyPress}
          disabled={!!feedback}
          placeholder={
            practiceDirection === 'en-to-ka'
              ? 'ჩაწერე ქართულად...'
              : 'Type in English...'
          }
          className="w-full px-8 py-6 text-3xl text-center border-4 border-indigo-200 rounded-2xl focus:border-indigo-600 outline-none transition font-georgian"
          autoFocus
        />

        {feedback === null ? (
          <button
            onClick={checkAnswer}
            disabled={!answer.trim()}
            className="w-full py-6 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-2xl font-bold rounded-2xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition"
          >
            Check Answer
          </button>
        ) : (
          <div>
            <div
              className={`p-8 rounded-2xl text-center mb-6 text-6xl font-bold ${
                feedback === 'correct'
                  ? 'bg-green-100 text-green-600'
                  : 'bg-red-100 text-red-600'
              }`}
            >
              {feedback === 'correct' ? 'Perfect!' : 'Incorrect!'}
            </div>

            {feedback === 'incorrect' && (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 mb-6 text-center">
                <p className="text-2xl font-bold text-red-700 mb-2">
                  Correct answer:
                </p>
                <p className="text-4xl font-bold text-gray-800">
                  {practiceDirection === 'en-to-ka'
                    ? currentWord.georgian
                    : currentWord.english}
                </p>
              </div>
            )}

            <button
              onClick={goToNextWord}
              className="w-full py-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-2xl font-bold rounded-2xl hover:from-green-600 hover:to-emerald-700 transition"
            >
              Next Word →
            </button>
          </div>
        )}
      </div>

      <button
        onClick={endPractice}
        className="w-full mt-8 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition"
      >
        End Practice
      </button>
    </div>
  );
};

// Auth View
const AuthView = ({ setCurrentView }) => {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    const result = isLogin
      ? await login(email, password)
      : await register(email, password);

    setLoading(false);

    if (!result.success) {
      setError(result.error);
    } else {
      // წარმატებული შესვლის შემდეგ გადავდივართ My Words გვერდზე
      setCurrentView('words');
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-xl shadow-md p-8">
        <div className="text-center mb-6">
          <Book className="w-12 h-12 text-indigo-600 mx-auto mb-3" />
          <h2 className="text-3xl font-bold text-gray-800">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-gray-600 mt-2">
            {isLogin
              ? 'Login to access your words'
              : 'Register to save your vocabulary'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:bg-gray-400 font-semibold"
          >
            {loading ? 'Processing...' : isLogin ? 'Login' : 'Register'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
          >
            {isLogin
              ? "Don't have an account? Register"
              : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Subscription View

const SubscriptionView = () => {
  const { user, subscribe } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleSubscribe = async () => {
    if (processing || !selectedPlan) return;

    // 1. მყისიერად ვაჩვენოთ წარმატება (Optimistic UI)
    setProcessing(true);
    setSelectedPlan(null);

    // მომხმარებელს მაშინვე ვაჩვენოთ, რომ გააქტიურდა
    alert('Premium activated instantly!');

    // 2. ფონზე გავგზავნოთ Supabase-ში (არ დაველოდოთ)
    subscribe(selectedPlan).catch((err) => {
      // თუ რამე შეცდომა მოხდა – მაინც არ გავაუქმოთ UI-ში
      console.error('Background sync failed:', err);
      // შეგიძლია აქ toast ან რამე მცირე შეტყობინება
    });

    // 3. გავაახლოთ გვერდი 1 წამში – რომ სერვერის მონაცემები აისახოს
    setTimeout(() => {
      window.location.reload();
    }, 800);

    setProcessing(false);
  };

  const handleCancel = async () => {
    try {
      await supabase
        .from('profiles')
        .update({
          is_subscribed: false,
          subscription_expiry: null,
          subscription_type: null,
        })
        .eq('id', user.id);

      window.location.reload(); // სწრაფი განახლება
    } catch (err) {
      alert('Failed to cancel subscription.');
    }
  };

  // თუ უკვე Premium
  if (user?.isSubscribed) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 px-4">
        <Crown className="w-20 h-20 text-yellow-500 mx-auto mb-6" />
        <h1 className="text-4xl font-bold text-gray-800 mb-4">
          Premium Active
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Valid until:{' '}
          <span className="font-bold text-indigo-600">
            {user.subscriptionExpiry
              ? new Date(user.subscriptionExpiry).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Lifetime'}
          </span>
        </p>
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="px-8 py-4 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition"
        >
          Cancel Subscription
        </button>

        {showCancelConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
              <h3 className="text-2xl font-bold mb-4">Cancel Subscription?</h3>
              <p className="text-gray-600 mb-8">
                You will lose Premium features.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={handleCancel}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold"
                >
                  Yes, Cancel
                </button>
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-3 bg-gray-300 rounded-xl font-bold"
                >
                  Keep Premium
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">
          Choose Your Plan
        </h1>
        <p className="text-xl text-gray-600">Start free • Upgrade anytime</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {/* Free Plan – Default */}
        <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
          <h3 className="text-2xl font-bold text-gray-800 mb-4">Free</h3>
          <div className="text-5xl font-bold text-gray-800 mb-2">$0</div>
          <p className="text-gray-600 mb-8">forever</p>
          <ul className="space-y-3 mb-10 text-gray-700">
            <li className="flex items-center">
              <Check className="w-5 h-5 text-green-600 mr-3" /> Up to 30 words
            </li>
            <li className="flex items-center">
              <Check className="w-5 h-5 text-green-600 mr-3" /> Basic practice
            </li>
            <li className="flex items-center">
              <X className="w-5 h-5 text-gray-400 mr-3" /> No catalogs
            </li>
            <li className="flex items-center">
              <X className="w-5 h-5 text-gray-400 mr-3" /> Data lost on close
            </li>
          </ul>
          <button
            disabled
            className="w-full py-4 bg-gray-100 text-gray-500 rounded-xl font-bold cursor-not-allowed"
          >
            Current Plan
          </button>
        </div>

        {/* Monthly Plan – $1.99 */}
        <div className="relative bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl shadow-2xl p-8 text-white transform scale-105 z-10">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-yellow-400 text-purple-900 px-6 py-2 rounded-full font-bold text-sm">
            MOST POPULAR
          </div>
          <h3 className="text-3xl font-bold mb-4">Monthly</h3>
          <div className="text-6xl font-bold mb-2">$1.99</div>
          <p className="text-xl opacity-90 mb-8">per month</p>
          <ul className="space-y-4 mb-10">
            <li className="flex items-center">
              <Check className="w-6 h-6 mr-3" /> Unlimited words
            </li>
            <li className="flex items-center">
              <Check className="w-6 h-6 mr-3" /> Save forever
            </li>
            <li className="flex items-center">
              <Check className="w-6 h-6 mr-3" /> Unlimited catalogs
            </li>
            <li className="flex items-center">
              <Check className="w-6 h-6 mr-3" /> Works on all devices
            </li>
          </ul>
          <button
            onClick={() => setSelectedPlan('monthly')}
            className="w-full py-5 bg-white text-purple-600 rounded-xl font-bold text-xl hover:bg-gray-100 transition"
          >
            Get Monthly
          </button>
        </div>

        {/* Yearly Plan – $9.99 */}
        <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl shadow-2xl p-8 text-white">
          <div className="bg-green-400 text-indigo-900 px-5 py-2 rounded-full font-bold text-sm inline-block mb-4">
            Save 58%
          </div>
          <h3 className="text-3xl font-bold mb-4">Yearly</h3>
          <div className="text-6xl font-bold mb-2">$9.99</div>
          <p className="text-xl opacity-90 mb-8">per year</p>
          <p className="text-lg opacity-80 mb-8">only $0.83/month</p>
          <button
            onClick={() => setSelectedPlan('yearly')}
            className="w-full py-5 bg-white text-indigo-600 rounded-xl font-bold text-xl hover:bg-gray-100 transition"
          >
            Get Yearly
          </button>
        </div>
      </div>

      {/* Payment Modal – Instant Activation */}
      {selectedPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-10 max-w-md w-full shadow-2xl">
            <h3 className="text-3xl font-bold text-center mb-8 text-gray-800">
              Complete Your Purchase
            </h3>
            <p className="text-center text-xl mb-10 text-gray-600">
              {selectedPlan === 'monthly' ? '$1.99/month' : '$9.99/year'}
            </p>

            <div className="space-y-6 mb-10">
              <input
                type="text"
                placeholder="4242 4242 4242 4242"
                defaultValue="4242 4242 4242 4242"
                className="w-full px-6 py-4 border-2 border-gray-300 rounded-xl text-lg focus:border-indigo-500 outline-none"
              />
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="MM/YY"
                  defaultValue="12/28"
                  className="px-6 py-4 border-2 border-gray-300 rounded-xl text-lg"
                />
                <input
                  type="text"
                  placeholder="CVC"
                  defaultValue="123"
                  className="px-6 py-4 border-2 border-gray-300 rounded-xl text-lg"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleSubscribe}
                disabled={processing}
                className="flex-1 py-5 bg-indigo-600 text-white text-xl font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-70"
              >
                {processing ? 'Activating...' : 'Complete Payment'}
              </button>
              <button
                onClick={() => setSelectedPlan(null)}
                className="px-8 py-5 bg-gray-200 rounded-xl font-bold hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// About View — მობილურზე ლამაზი
const AboutView = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-purple-50 to-pink-50 px-6 py-12">
      <div className="max-w-6xl mx-auto text-center">
        {/* Title */}
        <div className="mb-16">
          <Book className="w-16 h-16 md:w-20 md:h-20 text-indigo-600 mx-auto mb-6" />
          <h1 className="text-4xl md:text-6xl font-bold text-gray-800 mb-6 leading-tight">
            About VocabMaster
          </h1>
          <p className="text-lg md:text-xl text-gray-700 max-w-3xl mx-auto leading-relaxed">
            A simple, powerful, and beautiful tool to help you master English
            vocabulary with Georgian translations — fast and effectively.
          </p>
        </div>

        {/* Colorful Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Card 1 */}
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl p-8 text-white shadow-2xl transform hover:scale-105 transition duration-300">
            <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Infinity className="w-10 h-10" />
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-4">
              Unlimited Words
            </h3>
            <p className="text-lg opacity-95">
              Save as many words as you want with Premium
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-gradient-to-br from-indigo-500 to-blue-500 rounded-3xl p-8 text-white shadow-2xl transform hover:scale-105 transition duration-300">
            <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Zap className="w-10 h-10" />
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-4">
              Smart Practice
            </h3>
            <p className="text-lg opacity-95">
              Test yourself with instant feedback
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-3xl p-8 text-white shadow-2xl transform hover:scale-105 transition duration-300">
            <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FolderOpen className="w-10 h-10" />
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-4">
              Organized Catalogs
            </h3>
            <p className="text-lg opacity-95">Group words by topic or level</p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-20 text-xl text-gray-700">
          Made with <span className="text-red-500 text-3xl">❤</span> in Georgia
          <span className="text-gray-500"> • For learners, by a learner</span>
        </p>
      </div>
    </div>
  );
};

// Contact View — მობილურზე იდეალური
const ContactView = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-pink-50 px-6 py-20">
      <div className="max-w-2xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-800 mb-8">
          Contact Us
        </h1>

        <p className="text-xl md:text-2xl text-gray-700 mb-16 leading-relaxed">
          Have a question, suggestion, or just want to say hello?
          <br className="hidden md:block" />
          We'd love to hear from you!
        </p>

        <div className="bg-white rounded-3xl shadow-2xl p-12">
          <a
            href="mailto:support@vocabmaster.app"
            className="block text-2xl md:text-3xl lg:text-4xl font-bold text-indigo-600 hover:text-indigo-700 transition 
                       break-all tracking-tight leading-tight  decoration-4 underline-offset-8"
          >
            sergo.khmaladze@gmail.com
          </a>

          <p className="text-gray-600 mt-8 text-lg">
            We usually reply within a few hours
          </p>
        </div>

        <p className="text-gray-500 mt-16 text-sm">
          Made with <span className="text-red-500">❤</span> in Georgia
        </p>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <VocabApp />
    </AuthProvider>
  );
}
