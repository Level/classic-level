#define NAPI_VERSION 3

#include <napi-macros.h>
#include <node_api.h>
#include <assert.h>

#include <leveldb/db.h>
#include <leveldb/write_batch.h>
#include <leveldb/cache.h>
#include <leveldb/filter_policy.h>

#include <map>
#include <vector>
#include <mutex>
#include <atomic>
#include <optional>

/**
 * Forward declarations.
 */
struct Database;
struct Resource;
struct Iterator;
struct ExplicitSnapshot;
static leveldb::Status threadsafe_open(const leveldb::Options &options,
                                       bool multithreading,
                                       Database &db_instance);
static leveldb::Status threadsafe_close(Database &db_instance);

/**
 * Global declarations for multi-threaded access. These are not context-aware
 * by definition and is specifically to allow for cross thread access to the
 * single database handle.
 */
struct LevelDbHandle
{
  leveldb::DB *db;
  size_t open_handle_count;
};
static std::mutex handles_mutex;
// only access this when protected by the handles_mutex!
static std::map<std::string, LevelDbHandle> db_handles;

/**
 * Macros.
 */
#define NAPI_DB_CONTEXT() \
  Database* database = NULL; \
  NAPI_STATUS_THROWS(napi_get_value_external(env, argv[0], (void**)&database));

#define NAPI_ITERATOR_CONTEXT() \
  Iterator* iterator = NULL; \
  NAPI_STATUS_THROWS(napi_get_value_external(env, argv[0], (void**)&iterator));

#define NAPI_BATCH_CONTEXT() \
  Batch* batch = NULL; \
  NAPI_STATUS_THROWS(napi_get_value_external(env, argv[0], (void**)&batch));

#define NAPI_SNAPSHOT_CONTEXT() \
  ExplicitSnapshot* snapshot = NULL; \
  NAPI_STATUS_THROWS(napi_get_value_external(env, argv[0], (void**)&snapshot));

#define NAPI_RETURN_UNDEFINED() \
  return 0;

#define NAPI_PROMISE() \
  napi_deferred deferred; \
  napi_value promise; \
  NAPI_STATUS_THROWS(napi_create_promise(env, &deferred, &promise));

#define NAPI_UTF8_NEW(name, val)                \
  size_t name##_size = 0;                                               \
  NAPI_STATUS_THROWS(napi_get_value_string_utf8(env, val, NULL, 0, &name##_size)) \
  char* name = new char[name##_size + 1];                               \
  NAPI_STATUS_THROWS(napi_get_value_string_utf8(env, val, name, name##_size + 1, &name##_size)) \
  name[name##_size] = '\0';

#define NAPI_ARGV_UTF8_NEW(name, i) \
  NAPI_UTF8_NEW(name, argv[i])

// TODO: consider using encoding options instead of type checking
#define LD_STRING_OR_BUFFER_TO_COPY(env, from, to)                      \
  char* to##Ch_ = 0;                                                    \
  size_t to##Sz_ = 0;                                                   \
  if (IsString(env, from)) {                                            \
    napi_get_value_string_utf8(env, from, NULL, 0, &to##Sz_);           \
    to##Ch_ = new char[to##Sz_ + 1];                                    \
    napi_get_value_string_utf8(env, from, to##Ch_, to##Sz_ + 1, &to##Sz_); \
    to##Ch_[to##Sz_] = '\0';                                            \
  } else if (IsBuffer(env, from)) {                                     \
    char* buf = 0;                                                      \
    napi_get_buffer_info(env, from, (void **)&buf, &to##Sz_);           \
    to##Ch_ = new char[to##Sz_];                                        \
    memcpy(to##Ch_, buf, to##Sz_);                                      \
  } else {                                                              \
    char* buf = 0;                                                      \
    napi_typedarray_type type;                                          \
    napi_status status = napi_get_typedarray_info(env, from, &type, &to##Sz_, (void **)&buf, NULL, NULL); \
    if (status != napi_ok || type != napi_typedarray_type::napi_uint8_array) { \
      /* TODO: refactor so that we can napi_throw_type_error() here */  \
      to##Sz_ = 0;                                                      \
      to##Ch_ = new char[to##Sz_];                                      \
    } else {                                                            \
      to##Ch_ = new char[to##Sz_];                                      \
      memcpy(to##Ch_, buf, to##Sz_);                                    \
    }                                                                   \
  }

#define undefined NULL

/**
 * Bit fields.
 */
#define STATE_ENDED 1

/*********************************************************************
 * Helpers.
 ********************************************************************/

/**
 * Returns true if 'value' is a string.
 */
static bool IsString (napi_env env, napi_value value) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  return type == napi_string;
}

/**
 * Returns true if 'value' is a buffer.
 */
static bool IsBuffer (napi_env env, napi_value value) {
  bool isBuffer;
  napi_is_buffer(env, value, &isBuffer);
  return isBuffer;
}

/**
 * Returns true if 'value' is an object.
 */
static bool IsObject (napi_env env, napi_value value) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  return type == napi_object;
}

/**
 * Create an error object.
 */
static napi_value CreateError (napi_env env, const char* str) {
  napi_value msg;
  napi_create_string_utf8(env, str, strlen(str), &msg);
  napi_value error;
  napi_create_error(env, NULL, msg, &error);
  return error;
}

static napi_value CreateCodeError (napi_env env, const char* code, const char* msg) {
  napi_value codeValue;
  napi_create_string_utf8(env, code, strlen(code), &codeValue);
  napi_value msgValue;
  napi_create_string_utf8(env, msg, strlen(msg), &msgValue);
  napi_value error;
  napi_create_error(env, codeValue, msgValue, &error);
  return error;
}

static void ThrowError(napi_env env, leveldb::Status status) {
  if (status.IsCorruption()) {
    napi_throw_error(env, "LEVEL_CORRUPTION", status.ToString().c_str());
  } else if (!status.ok()) {
    napi_throw_error(env, NULL, status.ToString().c_str());
  } else {
    napi_throw_error(env, NULL, "Operation failed");
  }
}

static napi_value ErrorOrNotFound(napi_env env, leveldb::Status status) {
  if (status.IsNotFound()) {
    return undefined;
  } else {
    ThrowError(env, status);
    return undefined;
  }
}

/**
 * Returns true if 'obj' has a property 'key'.
 */
static bool HasProperty (napi_env env, napi_value obj, const char* key) {
  bool has = false;
  napi_has_named_property(env, obj, key, &has);
  return has;
}

/**
 * Returns a property in napi_value form.
 */
static napi_value GetProperty (napi_env env, napi_value obj, const char* key) {
  napi_value value;
  napi_get_named_property(env, obj, key, &value);
  return value;
}

/**
 * Returns a boolean property 'key' from 'obj'.
 * Returns 'DEFAULT' if the property doesn't exist.
 */
static bool BooleanProperty (napi_env env, napi_value obj, const char* key,
                             bool DEFAULT) {
  if (HasProperty(env, obj, key)) {
    napi_value value = GetProperty(env, obj, key);
    bool result;
    napi_get_value_bool(env, value, &result);
    return result;
  }

  return DEFAULT;
}

/**
 * Returns a boolean value.
 * Returns 'DEFAULT' if the JS value is undefined or otherwise not a boolean.
 */
static bool BooleanValue (napi_env env, napi_value value, bool DEFAULT) {
  bool result;

  if (napi_get_value_bool(env, value, &result) == napi_ok) {
    return result;
  } else {
    return DEFAULT;
  }
}

enum Encoding { buffer, utf8, view };

/**
 * Returns internal Encoding enum matching the given encoding option.
 */
static Encoding GetEncoding (napi_env env, napi_value options, const char* option) {
  napi_value value;
  size_t copied;
  char buf[2];

  if (napi_get_named_property(env, options, option, &value) == napi_ok &&
    napi_get_value_string_utf8(env, value, buf, 2, &copied) == napi_ok && copied == 1) {
    // Value is either "buffer", "utf8" or "view" so we only have to read the first char
    switch (buf[0]) {
      case 'b': return Encoding::buffer;
      case 'v': return Encoding::view;
    }
  }

  return Encoding::utf8;
}

/**
 * Returns internal Encoding enum by its equivalent numeric value.
 */
static Encoding GetEncoding (napi_env env, napi_value value) {
  int32_t result;

  if (napi_get_value_int32(env, value, &result) == napi_ok) {
    return static_cast<Encoding>(result);
  }

  return Encoding::utf8;
}

/**
 * Returns a uint32 property 'key' from 'obj'.
 * Returns 'DEFAULT' if the property doesn't exist.
 */
static uint32_t Uint32Property (napi_env env, napi_value obj, const char* key,
                                uint32_t DEFAULT) {
  if (HasProperty(env, obj, key)) {
    napi_value value = GetProperty(env, obj, key);
    uint32_t result;
    napi_get_value_uint32(env, value, &result);
    return result;
  }

  return DEFAULT;
}

/**
 * Returns a int32 property 'key' from 'obj'.
 * Returns 'DEFAULT' if the property doesn't exist.
 */
static int Int32Property (napi_env env, napi_value obj, const char* key,
                          int DEFAULT) {
  if (HasProperty(env, obj, key)) {
    napi_value value = GetProperty(env, obj, key);
    int result;
    napi_get_value_int32(env, value, &result);
    return result;
  }

  return DEFAULT;
}

/**
 * Returns a string property 'key' from 'obj'.
 * Returns empty string if the property doesn't exist.
 */
static std::string StringProperty (napi_env env, napi_value obj, const char* key) {
  if (HasProperty(env, obj, key)) {
    napi_value value = GetProperty(env, obj, key);
    if (IsString(env, value)) {
      size_t size = 0;
      napi_get_value_string_utf8(env, value, NULL, 0, &size);

      char* buf = new char[size + 1];
      napi_get_value_string_utf8(env, value, buf, size + 1, &size);
      buf[size] = '\0';

      std::string result = buf;
      delete [] buf;
      return result;
    }
  }

  return "";
}

static void DisposeSliceBuffer (leveldb::Slice slice) {
  if (!slice.empty()) delete [] slice.data();
}

/**
 * Convert a napi_value to a leveldb::Slice.
 */
static leveldb::Slice ToSlice (napi_env env, napi_value from) {
  LD_STRING_OR_BUFFER_TO_COPY(env, from, to);
  return leveldb::Slice(toCh_, toSz_);
}

/**
 * Takes a Buffer, string or Uint8Array property 'name' from 'opts'.
 * Returns null if the property does not exist.
 */
static std::string* RangeOption (napi_env env, napi_value opts, const char* name) {
  if (HasProperty(env, opts, name)) {
    napi_value value = GetProperty(env, opts, name);
    // TODO: we can avoid a copy here
    LD_STRING_OR_BUFFER_TO_COPY(env, value, to);
    std::string* result = new std::string(toCh_, toSz_);
    delete [] toCh_;
    return result;
  }

  return NULL;
}

/**
 * Converts an array containing Buffer or string keys to a vector.
 */
static std::vector<std::string> KeyArray (napi_env env, napi_value arr) {
  uint32_t length;
  std::vector<std::string> result;

  if (napi_get_array_length(env, arr, &length) == napi_ok) {
    result.reserve(length);

    for (uint32_t i = 0; i < length; i++) {
      napi_value element;

      if (napi_get_element(env, arr, i, &element) == napi_ok) {
        LD_STRING_OR_BUFFER_TO_COPY(env, element, to);
        result.emplace_back(toCh_, toSz_);
        delete [] toCh_;
      }
    }
  }

  return result;
}

// TODO: use in more places
enum Flags : uint32_t {
  FILL_CACHE = 1,
  KEY_AS_BUFFER = 2,
  VALUE_AS_BUFFER = 4,
  SHARED_KEY = 8
};

/**
 * Whether to yield entries, keys or values.
 */
enum Mode {
  entries,
  keys,
  values
};

/**
 * Helper struct for caching and converting a key-value pair to napi_values.
 */
struct Entry {
  Entry (const leveldb::Slice& key, const leveldb::Slice& value)
    : key_(key.data(), key.size()),
      value_(value.data(), value.size()) {}

  void ConvertByMode (napi_env env, Mode mode, const Encoding keyEncoding, const Encoding valueEncoding, napi_value& result) const {
    if (mode == Mode::entries) {
      napi_create_array_with_length(env, 2, &result);

      napi_value keyElement;
      napi_value valueElement;

      Convert(env, &key_, keyEncoding, keyElement);
      Convert(env, &value_, valueEncoding, valueElement);

      napi_set_element(env, result, 0, keyElement);
      napi_set_element(env, result, 1, valueElement);
    } else if (mode == Mode::keys) {
      Convert(env, &key_, keyEncoding, result);
    } else {
      Convert(env, &value_, valueEncoding, result);
    }
  }

  static void Convert (napi_env env, const std::string* s, const Encoding encoding, napi_value& result) {
    if (s == NULL) {
      napi_get_undefined(env, &result);
    } else if (encoding == Encoding::buffer || encoding == Encoding::view) {
      napi_create_buffer_copy(env, s->size(), s->data(), NULL, &result);
    } else {
      napi_create_string_utf8(env, s->data(), s->size(), &result);
    }
  }

private:
  std::string key_;
  std::string value_;
};

/**
 * Base worker class. Handles the async work. Derived classes can override the
 * following virtual methods (listed in the order in which they're called):
 *
 * - DoExecute (abstract, worker pool thread): main work
 * - HandleOKCallback (main thread): resolve JS promise on success
 * - HandleErrorCallback (main thread): reject JS promise on error
 * - DoFinally (main thread): do cleanup regardless of success
 */
struct BaseWorker {
  // Note: storing env is discouraged as we'd end up using it in unsafe places.
  BaseWorker (napi_env env,
              Database* database,
              napi_deferred deferred,
              const char* resourceName)
    : database_(database), errMsg_(NULL), deferred_(deferred) {
    // Note: napi_deferred is a strong reference to the JS promise, so there's no need to
    // create a reference ourselves. See `v8_deferred = new v8::Persistent<v8::Value>()` in:
    // https://github.com/nodejs/node/commit/7efb8f7619100973877c660d0ee527ea3d92de8d

    napi_value asyncResourceName;
    NAPI_STATUS_THROWS_VOID(napi_create_string_utf8(env, resourceName,
                                               NAPI_AUTO_LENGTH,
                                               &asyncResourceName));
    NAPI_STATUS_THROWS_VOID(napi_create_async_work(env, NULL,
                                              asyncResourceName,
                                              BaseWorker::Execute,
                                              BaseWorker::Complete,
                                              this, &asyncWork_));
  }

  virtual ~BaseWorker () {
    delete [] errMsg_;
  }

  static void Execute (napi_env env, void* data) {
    BaseWorker* self = (BaseWorker*)data;

    // Don't pass env to DoExecute() because use of Node-API
    // methods should generally be avoided in async work.
    self->DoExecute();
  }

  bool SetStatus (leveldb::Status status) {
    status_ = status;
    if (!status.ok()) {
      SetErrorMessage(status.ToString().c_str());
      return false;
    }
    return true;
  }

  void SetErrorMessage(const char *msg) {
    delete [] errMsg_;
    size_t size = strlen(msg) + 1;
    errMsg_ = new char[size];
    memcpy(errMsg_, msg, size);
  }

  virtual void DoExecute () = 0;

  static void Complete (napi_env env, napi_status status, void* data) {
    BaseWorker* self = (BaseWorker*)data;

    self->DoComplete(env);
    self->DoFinally(env);
  }

  void DoComplete (napi_env env) {
    if (status_.ok()) {
      HandleOKCallback(env, deferred_);
    } else {
      HandleErrorCallback(env, deferred_);
    }
  }

  virtual void HandleOKCallback (napi_env env, napi_deferred deferred) {
    napi_value argv;
    napi_get_undefined(env, &argv);
    napi_resolve_deferred(env, deferred, argv);
  }

  virtual void HandleErrorCallback (napi_env env, napi_deferred deferred) {
    napi_value argv;

    if (status_.IsNotFound()) {
      napi_get_undefined(env, &argv);
      napi_resolve_deferred(env, deferred, argv);
      return;
    }

    if (status_.IsCorruption()) {
      argv = CreateCodeError(env, "LEVEL_CORRUPTION", errMsg_);
    } else if (status_.IsIOError()) {
      if (strlen(errMsg_) > 15 && strncmp("IO error: lock ", errMsg_, 15) == 0) { // env_posix.cc
        argv = CreateCodeError(env, "LEVEL_LOCKED", errMsg_);
      } else if (strlen(errMsg_) > 19 && strncmp("IO error: LockFile ", errMsg_, 19) == 0) { // env_win.cc
        argv = CreateCodeError(env, "LEVEL_LOCKED", errMsg_);
      } else {
        argv = CreateCodeError(env, "LEVEL_IO_ERROR", errMsg_);
      }
    } else {
      argv = CreateError(env, errMsg_);
    }

    napi_reject_deferred(env, deferred, argv);
  }

  virtual void DoFinally (napi_env env) {
    napi_delete_async_work(env, asyncWork_);
    deferred_ = NULL;
    delete this;
  }

  void Queue (napi_env env) {
    napi_queue_async_work(env, asyncWork_);
  }

  Database* database_;

private:
  napi_deferred deferred_;
  napi_async_work asyncWork_;
  leveldb::Status status_;
  char *errMsg_;
};

/**
 * Owns the LevelDB storage, cache, filter policy and resources.
 */
struct Database {
  Database ()
    : db_(NULL),
      sharedBuffer_(NULL),
      blockCache_(NULL),
      filterPolicy_(leveldb::NewBloomFilterPolicy(10)),
      resourceSequence_(0),
      pendingCloseWorker_(NULL),
      ref_(NULL),
      sharedBufferRef_(NULL),
      priorityWork_(0) {}

  ~Database () {
    if (db_ != NULL) {
      threadsafe_close(*this);
    }
  }

  leveldb::Status Open (const leveldb::Options& options,
                        const std::string &location,
                        bool multithreading) {
    location_ = location;
    return threadsafe_open(options, multithreading, *this);
  }

  void CloseDatabase () {
    if (db_ != NULL) {
      threadsafe_close(*this);
    }
    if (blockCache_) {
      delete blockCache_;
      blockCache_ = NULL;
    }
  }

  leveldb::Status Put (const leveldb::WriteOptions& options,
                       leveldb::Slice key,
                       leveldb::Slice value) {
    return db_->Put(options, key, value);
  }

  leveldb::Status Get (const leveldb::ReadOptions& options,
                       leveldb::Slice key,
                       leveldb::ValueSink& value) {
    return db_->Get(options, key, &value);
  }

  leveldb::Status Del (const leveldb::WriteOptions& options,
                       leveldb::Slice key) {
    return db_->Delete(options, key);
  }

  leveldb::Status WriteBatch (const leveldb::WriteOptions& options,
                              leveldb::WriteBatch* batch) {
    return db_->Write(options, batch);
  }

  uint64_t ApproximateSize (const leveldb::Range* range) {
    uint64_t size = 0;
    db_->GetApproximateSizes(range, 1, &size);
    return size;
  }

  void CompactRange (const leveldb::Slice* start,
                     const leveldb::Slice* end) {
    db_->CompactRange(start, end);
  }

  void GetProperty (const leveldb::Slice& property, std::string* value) {
    db_->GetProperty(property, value);
  }

  const leveldb::Snapshot* NewSnapshot () {
    return db_->GetSnapshot();
  }

  leveldb::Iterator* NewIterator (leveldb::ReadOptions* options) {
    return db_->NewIterator(*options);
  }

  void ReleaseSnapshot (const leveldb::Snapshot* snapshot) {
    return db_->ReleaseSnapshot(snapshot);
  }

  // The env argument is unused but reminds us to increment priorityWork_
  // only in the JavaScript main thread to avoid needing a lock around
  // that and pendingCloseWorker_.
  void IncrementPriorityWork (napi_env env) {
    priorityWork_++;
  }

  void DecrementPriorityWork (napi_env env) {
    if (--priorityWork_ == 0 && pendingCloseWorker_ != NULL) {
      pendingCloseWorker_->Queue(env);
      pendingCloseWorker_ = NULL;
    }
  }

  bool HasPriorityWork () const {
    return priorityWork_ > 0;
  }

  bool SetSharedBuffer (napi_env env, napi_value value) {
    // Delete reference to previous buffer if any
    if (sharedBufferRef_) {
      napi_delete_reference(env, sharedBufferRef_);
      sharedBufferRef_ = NULL;
    }

    // Get underlying data (length is separately communicated, on use)
    if (napi_get_buffer_info(env, value, (void**)&sharedBuffer_, NULL) != napi_ok) {
      sharedBuffer_ = NULL;
      return false;
    }

    // Create reference in order to keep buffer alive
    if (napi_create_reference(env, value, 1, &sharedBufferRef_) != napi_ok) {
      sharedBufferRef_ = NULL;
      return false;
    }

    return true;
  }

  void ReleaseReferences (napi_env env) {
    if (ref_ != NULL) napi_reference_unref(env, ref_, NULL);
    if (sharedBufferRef_ != NULL) napi_reference_unref(env, sharedBufferRef_, NULL);
  }

  void DeleteReferences (napi_env env) {
    if (ref_ != NULL) napi_delete_reference(env, ref_);
    if (sharedBufferRef_ != NULL) napi_delete_reference(env, sharedBufferRef_);
  }

  leveldb::DB* db_;
  char* sharedBuffer_;
  leveldb::Cache* blockCache_;
  const leveldb::FilterPolicy* filterPolicy_;
  uint32_t resourceSequence_;
  BaseWorker *pendingCloseWorker_;
  std::map<uint32_t, Resource*> resources_;
  napi_ref ref_;

private:
  napi_ref sharedBufferRef_;
  std::atomic<uint32_t> priorityWork_;
  std::string location_;

  // for separation of concerns the threadsafe functionality was kept at the global
  // level and made a friend so it is explict where the threadsafe boundary exists
  friend leveldb::Status threadsafe_open(const leveldb::Options &options,
                                         bool multithreading,
                                         Database &db_instance);
  friend leveldb::Status threadsafe_close(Database &db_instance);
};


leveldb::Status threadsafe_open(const leveldb::Options &options,
                                bool multithreading,
                                Database &db_instance) {
  // Bypass lock and handles if multithreading is disabled
  if (!multithreading) {
    return leveldb::DB::Open(options, db_instance.location_, &db_instance.db_);
  }

  std::unique_lock<std::mutex> lock(handles_mutex);

  auto it = db_handles.find(db_instance.location_);
  if (it == db_handles.end()) {
    // Database not opened yet for this location, unless it was with
    // multithreading disabled, in which case we're expected to fail here.
    LevelDbHandle handle = {nullptr, 0};
    leveldb::Status status = leveldb::DB::Open(options, db_instance.location_, &handle.db);

    if (status.ok()) {
      handle.open_handle_count++;
      db_instance.db_ = handle.db;
      db_handles[db_instance.location_] = handle;
    }

    return status;
  }

  ++(it->second.open_handle_count);
  db_instance.db_ = it->second.db;

  return leveldb::Status::OK();
}

leveldb::Status threadsafe_close(Database &db_instance) {
  std::unique_lock<std::mutex> lock(handles_mutex);

  auto it = db_handles.find(db_instance.location_);
  if (it == db_handles.end()) {
    // Was not opened with multithreading enabled
    delete db_instance.db_;
  } else if (--(it->second.open_handle_count) == 0) {
    delete it->second.db;
    db_handles.erase(it);
  }

  // ensure db_ pointer is nullified in Database instance
  db_instance.db_ = NULL;
  return leveldb::Status::OK();
}

/**
 * Represents an object that has a strong reference until explicitly closed. In
 * addition, resources are tracked in database->resources in order to close
 * them when the Node.js environment is tore down.
 */
struct Resource {
  Resource (Database* database)
    : database(database),
      id_(++database->resourceSequence_),
      ref_(NULL) {
  }

  virtual ~Resource () { }
  virtual void CloseResource () = 0;

  void Attach (napi_env env, napi_value context) {
    napi_create_reference(env, context, 1, &ref_);
    database->resources_[id_] = this;
  }

  void Detach (napi_env env) {
    database->resources_.erase(id_);
    if (ref_ != NULL) napi_delete_reference(env, ref_);
  }

  static void CollectGarbage (napi_env env, void* data, void* hint) {
    if (data) {
      delete (Resource*)data;
    }
  }

  Database* database;

private:
  const uint32_t id_;
  napi_ref ref_;
};

/**
 * Explicit snapshot of database.
 */
struct ExplicitSnapshot final : public Resource {
  ExplicitSnapshot (Database* database)
    : Resource(database),
      nut(database->NewSnapshot()) {
  }

  void CloseResource () override {
    database->ReleaseSnapshot(nut);
  }

  const leveldb::Snapshot* nut;
};

/**
 * Base worker class for doing async work that defers closing the database.
 */
struct PriorityWorker : public BaseWorker {
  PriorityWorker (napi_env env, Database* database, napi_deferred deferred, const char* resourceName)
    : BaseWorker(env, database, deferred, resourceName) {
      database_->IncrementPriorityWork(env);
  }

  virtual ~PriorityWorker () {}

  void DoFinally (napi_env env) override {
    database_->DecrementPriorityWork(env);
    BaseWorker::DoFinally(env);
  }
};

/**
 * Owns a leveldb iterator.
 */
struct BaseIterator {
  BaseIterator(Database* database,
               const bool reverse,
               std::string* lt,
               std::string* lte,
               std::string* gt,
               std::string* gte,
               const int limit,
               const bool fillCache,
               ExplicitSnapshot* snapshot)
    : database_(database),
      hasClosed_(false),
      didSeek_(false),
      reverse_(reverse),
      lt_(lt),
      lte_(lte),
      gt_(gt),
      gte_(gte),
      limit_(limit),
      count_(0) {
    options_ = new leveldb::ReadOptions();
    options_->fill_cache = fillCache;

    if (snapshot == NULL) {
      implicitSnapshot_ = database_->NewSnapshot();
      options_->snapshot = implicitSnapshot_;
    } else {
      implicitSnapshot_ = NULL;
      options_->snapshot = snapshot->nut;
    }

    dbIterator_ = database_->NewIterator(options_);
  }

  virtual ~BaseIterator () {
    assert(hasClosed_);

    if (lt_ != NULL) delete lt_;
    if (gt_ != NULL) delete gt_;
    if (lte_ != NULL) delete lte_;
    if (gte_ != NULL) delete gte_;

    delete options_;
  }

  bool DidSeek () const {
    return didSeek_;
  }

  /**
   * Seek to the first relevant key based on range options.
   */
  void SeekToRange () {
    didSeek_ = true;

    if (!reverse_ && gte_ != NULL) {
      dbIterator_->Seek(*gte_);
    } else if (!reverse_ && gt_ != NULL) {
      dbIterator_->Seek(*gt_);

      if (dbIterator_->Valid() && dbIterator_->key().compare(*gt_) == 0) {
        dbIterator_->Next();
      }
    } else if (reverse_ && lte_ != NULL) {
      dbIterator_->Seek(*lte_);

      if (!dbIterator_->Valid()) {
        dbIterator_->SeekToLast();
      } else if (dbIterator_->key().compare(*lte_) > 0) {
        dbIterator_->Prev();
      }
    } else if (reverse_ && lt_ != NULL) {
      dbIterator_->Seek(*lt_);

      if (!dbIterator_->Valid()) {
        dbIterator_->SeekToLast();
      } else if (dbIterator_->key().compare(*lt_) >= 0) {
        dbIterator_->Prev();
      }
    } else if (reverse_) {
      dbIterator_->SeekToLast();
    } else {
      dbIterator_->SeekToFirst();
    }
  }

  /**
   * Seek manually (during iteration).
   */
  void Seek (leveldb::Slice& target) {
    didSeek_ = true;

    if (OutOfRange(target)) {
      return SeekToEnd();
    }

    dbIterator_->Seek(target);

    if (dbIterator_->Valid()) {
      int cmp = dbIterator_->key().compare(target);
      if (reverse_ ? cmp > 0 : cmp < 0) {
        Next();
      }
    } else { // TODO: can we skip this code path if not in reverse?
      SeekToFirst();
      if (dbIterator_->Valid()) {
        int cmp = dbIterator_->key().compare(target);
        if (reverse_ ? cmp > 0 : cmp < 0) {
          SeekToEnd();
        }
      }
    }
  }

  /**
   * Seek to an exact key.
   */
  bool SeekExact (leveldb::Slice& target) {
    didSeek_ = true;
    dbIterator_->Seek(target);
    return dbIterator_->Valid() && dbIterator_->key() == target;
  }

  void CloseIterator () {
    if (!hasClosed_) {
      hasClosed_ = true;

      delete dbIterator_;
      dbIterator_ = NULL;

      if (implicitSnapshot_) {
        database_->ReleaseSnapshot(implicitSnapshot_);
      }
    }
  }

  bool Valid () const {
    return dbIterator_->Valid() && !OutOfRange(dbIterator_->key());
  }

  bool Increment () {
    return limit_ < 0 || ++count_ <= limit_;
  }

  void Next () {
    if (reverse_) dbIterator_->Prev();
    else dbIterator_->Next();
  }

  void SeekToFirst () {
    if (reverse_) dbIterator_->SeekToLast();
    else dbIterator_->SeekToFirst();
  }

  void SeekToLast () {
    if (reverse_) dbIterator_->SeekToFirst();
    else dbIterator_->SeekToLast();
  }

  void SeekToEnd () {
    SeekToLast();
    Next();
  }

  leveldb::Slice CurrentKey () const {
    return dbIterator_->key();
  }

  leveldb::Slice CurrentValue () const {
    return dbIterator_->value();
  }

  leveldb::Status Status () const {
    return dbIterator_->status();
  }

  bool OutOfRange (const leveldb::Slice& target) const {
    // The lte and gte options take precedence over lt and gt respectively
    if (lte_ != NULL) {
      if (target.compare(*lte_) > 0) return true;
    } else if (lt_ != NULL) {
      if (target.compare(*lt_) >= 0) return true;
    }

    if (gte_ != NULL) {
      if (target.compare(*gte_) < 0) return true;
    } else if (gt_ != NULL) {
      if (target.compare(*gt_) <= 0) return true;
    }

    return false;
  }

  Database* database_;
  bool hasClosed_;

private:
  leveldb::Iterator* dbIterator_;
  bool didSeek_;
  const bool reverse_;
  std::string* lt_;
  std::string* lte_;
  std::string* gt_;
  std::string* gte_;
  const int limit_;
  int count_;
  leveldb::ReadOptions* options_;
  const leveldb::Snapshot* implicitSnapshot_;
};

/**
 * Extends BaseIterator for reading it from JS land.
 */
struct Iterator final : public BaseIterator, public Resource {
  Iterator (Database* database,
            const bool reverse,
            const bool keys,
            const bool values,
            const int limit,
            std::string* lt,
            std::string* lte,
            std::string* gt,
            std::string* gte,
            const bool fillCache,
            const Encoding keyEncoding,
            const Encoding valueEncoding,
            const uint32_t highWaterMarkBytes,
            unsigned char* state,
            ExplicitSnapshot* snapshot)
    : BaseIterator(database, reverse, lt, lte, gt, gte, limit, fillCache, snapshot),
      Resource(database),
      keys_(keys),
      values_(values),
      keyEncoding_(keyEncoding),
      valueEncoding_(valueEncoding),
      highWaterMarkBytes_(highWaterMarkBytes),
      first_(true),
      nexting_(false),
      aborted_(false),
      ended_(false),
      state_(state) {
  }

  ~Iterator () {}

  void CloseResource () override {
    BaseIterator::CloseIterator();
  }

  bool ReadMany (uint32_t size) {
    cache_.clear();
    cache_.reserve(size);
    size_t bytesRead = 0;
    leveldb::Slice empty;

    while (!aborted_) {
      if (!first_) Next();
      else first_ = false;

      if (!Valid() || !Increment()) break;

      if (keys_ && values_) {
        leveldb::Slice k = CurrentKey();
        leveldb::Slice v = CurrentValue();
        cache_.emplace_back(k, v);
        bytesRead += k.size() + v.size();
      } else if (keys_) {
        leveldb::Slice k = CurrentKey();
        cache_.emplace_back(k, empty);
        bytesRead += k.size();
      } else if (values_) {
        leveldb::Slice v = CurrentValue();
        cache_.emplace_back(empty, v);
        bytesRead += v.size();
      }

      if (bytesRead > highWaterMarkBytes_ || cache_.size() >= size) {
        return true;
      }
    }

    ended_ = true;
    return false;
  }

  const bool keys_;
  const bool values_;
  const Encoding keyEncoding_;
  const Encoding valueEncoding_;
  const uint32_t highWaterMarkBytes_;
  bool first_;
  bool nexting_;
  std::atomic<bool> aborted_;
  bool ended_;
  unsigned char* state_;
  std::vector<Entry> cache_;
};

/**
 * Hook for when the environment exits. This hook will be called after
 * already-scheduled napi_async_work items have finished, which gives us
 * the guarantee that no db operations will be in-flight at this time.
 */
static void env_cleanup_hook (void* arg) {
  Database* database = (Database*)arg;

  // Do everything that db.close() does but synchronously. We're expecting that GC
  // did not (yet) collect the database because that would be a user mistake (not
  // closing their db) made during the lifetime of the environment. That's different
  // from an environment being torn down (like the main process or a worker thread)
  // where it's our responsibility to clean up. Note also, the following code must
  // be a safe noop if called before db_open() or after db_close().
  if (database && database->db_ != NULL) {
    for (const auto& kv : database->resources_) {
      kv.second->CloseResource();
    }

    database->CloseDatabase();
  }
}

/**
 * Runs when a Database is garbage collected.
 */
static void FinalizeDatabase (napi_env env, void* data, void* hint) {
  if (data) {
    Database* database = (Database*)data;
    napi_remove_env_cleanup_hook(env, env_cleanup_hook, database);
    database->DeleteReferences(env);
    delete database;
  }
}

/**
 * Returns a context object for a database.
 */
NAPI_METHOD(db_init) {
  Database* database = new Database();
  napi_add_env_cleanup_hook(env, env_cleanup_hook, database);

  napi_value result;
  NAPI_STATUS_THROWS(napi_create_external(env, database,
                                          FinalizeDatabase,
                                          NULL, &result));

  // Prevent GC of database before close()
  NAPI_STATUS_THROWS(napi_create_reference(env, result, 1, &database->ref_));

  return result;
}

/**
 * Worker class for opening a database.
 * TODO: shouldn't this be a PriorityWorker?
 */
struct OpenWorker final : public BaseWorker {
  OpenWorker (napi_env env,
              Database* database,
              napi_deferred deferred,
              const std::string& location,
              const bool createIfMissing,
              const bool errorIfExists,
              const bool compression,
              const bool multithreading,
              const uint32_t writeBufferSize,
              const uint32_t blockSize,
              const uint32_t maxOpenFiles,
              const uint32_t blockRestartInterval,
              const uint32_t maxFileSize)
    : BaseWorker(env, database, deferred, "classic_level.db.open"),
      location_(location),
      multithreading_(multithreading) {
    options_.block_cache = database->blockCache_;
    options_.filter_policy = database->filterPolicy_;
    options_.create_if_missing = createIfMissing;
    options_.error_if_exists = errorIfExists;
    options_.compression = compression
      ? leveldb::kSnappyCompression
      : leveldb::kNoCompression;
    options_.write_buffer_size = writeBufferSize;
    options_.block_size = blockSize;
    options_.max_open_files = maxOpenFiles;
    options_.block_restart_interval = blockRestartInterval;
    options_.max_file_size = maxFileSize;
  }

  ~OpenWorker () {}

  void DoExecute () override {
    SetStatus(database_->Open(options_, location_, multithreading_));
  }

  leveldb::Options options_;
  std::string location_;
  bool multithreading_;
};

/**
 * Open a database.
 */
NAPI_METHOD(db_open) {
  NAPI_ARGV(3);
  NAPI_DB_CONTEXT();
  NAPI_ARGV_UTF8_NEW(location, 1);
  NAPI_PROMISE();

  napi_value options = argv[2];
  const bool createIfMissing = BooleanProperty(env, options, "createIfMissing", true);
  const bool errorIfExists = BooleanProperty(env, options, "errorIfExists", false);
  const bool compression = BooleanProperty(env, options, "compression", true);
  const bool multithreading = BooleanProperty(env, options, "multithreading", false);

  const uint32_t cacheSize = Uint32Property(env, options, "cacheSize", 8 << 20);
  const uint32_t writeBufferSize = Uint32Property(env, options , "writeBufferSize" , 4 << 20);
  const uint32_t blockSize = Uint32Property(env, options, "blockSize", 4096);
  const uint32_t maxOpenFiles = Uint32Property(env, options, "maxOpenFiles", 1000);
  const uint32_t blockRestartInterval = Uint32Property(env, options,
                                                 "blockRestartInterval", 16);
  const uint32_t maxFileSize = Uint32Property(env, options, "maxFileSize", 2 << 20);

  database->blockCache_ = leveldb::NewLRUCache(cacheSize);

  OpenWorker* worker = new OpenWorker(
    env, database, deferred, location,
    createIfMissing, errorIfExists,
    compression, multithreading,
    writeBufferSize, blockSize,
    maxOpenFiles, blockRestartInterval,
    maxFileSize
  );

  worker->Queue(env);
  delete [] location;

  return promise;
}

/**
 * Worker class for closing a database
 *
 * TODO: once we've moved the PriorityWork logic to AbstractLevel, check if
 * CloseDatabase is fast enough to be done synchronously.
 */
struct CloseWorker final : public BaseWorker {
  CloseWorker (napi_env env, Database* database, napi_deferred deferred)
    : BaseWorker(env, database, deferred, "classic_level.db.close") {}

  ~CloseWorker () {}

  void DoExecute () override {
    database_->CloseDatabase();
  }

  void DoFinally (napi_env env) override {
    database_->ReleaseReferences(env);
    BaseWorker::DoFinally(env);
  }
};

napi_value noop_callback (napi_env env, napi_callback_info info) {
  return 0;
}

/**
 * Close a database.
 */
NAPI_METHOD(db_close) {
  NAPI_ARGV(1);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  // AbstractLevel should not call _close() before resources are closed
  assert(database->resources_.size() == 0);

  CloseWorker* worker = new CloseWorker(env, database, deferred);

  if (!database->HasPriorityWork()) {
    worker->Queue(env);
  } else {
    database->pendingCloseWorker_ = worker;
  }

  return promise;
}

/**
 * Worker class for putting key/value to the database
 */
struct PutWorker final : public PriorityWorker {
  PutWorker (napi_env env,
             Database* database,
             napi_deferred deferred,
             leveldb::Slice key,
             leveldb::Slice value,
             bool sync)
    : PriorityWorker(env, database, deferred, "classic_level.db.put"),
      key_(key), value_(value) {
    options_.sync = sync;
  }

  ~PutWorker () {
    DisposeSliceBuffer(key_);
    DisposeSliceBuffer(value_);
  }

  void DoExecute () override {
    SetStatus(database_->Put(options_, key_, value_));
  }

  leveldb::WriteOptions options_;
  leveldb::Slice key_;
  leveldb::Slice value_;
};

/**
 * Puts a key and a value to a database.
 */
NAPI_METHOD(db_put) {
  NAPI_ARGV(4);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  leveldb::Slice key = ToSlice(env, argv[1]);
  leveldb::Slice value = ToSlice(env, argv[2]);
  bool sync = BooleanProperty(env, argv[3], "sync", false);

  PutWorker* worker = new PutWorker(env, database, deferred, key, value, sync);
  worker->Queue(env);

  return promise;
}

/**
 * Worker class for getting a value from a database.
 */
struct GetWorker final : public PriorityWorker {
  GetWorker (napi_env env,
             Database* database,
             napi_deferred deferred,
             uint32_t flags,
             leveldb::Slice key,
             napi_ref keyRef,
             ExplicitSnapshot* snapshot)
    : PriorityWorker(env, database, deferred, "classic_level.db.get"),
      flags_(flags),
      key_(key),
      keyRef_(keyRef) {
    options_.fill_cache = (flags & Flags::FILL_CACHE) != 0;

    if (snapshot == NULL) {
      implicitSnapshot_ = database->NewSnapshot();
      options_.snapshot = implicitSnapshot_;
    } else {
      implicitSnapshot_ = NULL;
      options_.snapshot = snapshot->nut;
    }
  }

  ~GetWorker () {
    if (!keyRef_) DisposeSliceBuffer(key_);
  }

  void DoExecute () override {
    leveldb::StringValueSink wrapped(&value_);
    SetStatus(database_->Get(options_, key_, wrapped));

    if (implicitSnapshot_) {
      database_->ReleaseSnapshot(implicitSnapshot_);
    }
  }

  void DoFinally (napi_env env) override {
    if (keyRef_) napi_delete_reference(env, keyRef_);
    PriorityWorker::DoFinally(env);
  }

  void HandleOKCallback (napi_env env, napi_deferred deferred) override {
    napi_value argv;

    if ((flags_ & Flags::VALUE_AS_BUFFER) != 0) {
      napi_create_buffer_copy(env, value_.size(), value_.data(), NULL, &argv);
    } else {
      napi_create_string_utf8(env, value_.data(), value_.size(), &argv);
    }

    napi_resolve_deferred(env, deferred, argv);
  }

private:
  leveldb::ReadOptions options_;
  uint32_t flags_;
  leveldb::Slice key_;
  napi_ref keyRef_;
  std::string value_;
  const leveldb::Snapshot* implicitSnapshot_;
};

/**
 * Gets a value from a database.
 */
 NAPI_METHOD(db_get) {
  NAPI_ARGV(4);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  uint32_t flags;
  NAPI_STATUS_THROWS(napi_get_value_uint32(env, argv[1], &flags));

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[3], (void**)&snapshot);

  char* keyBuffer;
  size_t keySize;
  GetWorker* worker;

  if ((flags & Flags::KEY_AS_BUFFER) != 0) {
    // Instead of copying the memory, create a reference so that it stays valid
    napi_ref keyRef;
    NAPI_STATUS_THROWS(napi_create_reference(env, argv[2], 1, &keyRef));
    NAPI_STATUS_THROWS(napi_get_typedarray_info(env, argv[2], NULL, &keySize, (void**)&keyBuffer, NULL, NULL));
    leveldb::Slice keySlice(keyBuffer, keySize);
    worker = new GetWorker(env, database, deferred, flags, keySlice, keyRef, snapshot);
  } else {
    NAPI_STATUS_THROWS(napi_get_value_string_utf8(env, argv[2], NULL, 0, &keySize));
    keyBuffer = new char[keySize + 1];
    NAPI_STATUS_THROWS(napi_get_value_string_utf8(env, argv[2], keyBuffer, keySize + 1, NULL));
    keyBuffer[keySize] = '\0';
    leveldb::Slice keySlice(keyBuffer, keySize);

    // A null keyRef implies that keyBuffer needs to be deleted after the read
    // TODO: solve in a more obvious way like a subclass
    worker = new GetWorker(env, database, deferred, flags, keySlice, NULL, snapshot);
  }

  worker->Queue(env);
  return promise;
}

struct NapiValueSink : public leveldb::ValueSink {
  NapiValueSink (napi_env env)
    : leveldb::ValueSink(),
      result(NULL),
      env_(env),
      status_(napi_generic_failure) {}

  virtual ~NapiValueSink() = default;

  const bool valid() {
    return status_ == napi_ok;
  }

napi_value result;

protected:
  napi_env env_;
  napi_status status_;
};

struct NapiStringValueSink : public NapiValueSink {
  NapiStringValueSink (napi_env env)
    : NapiValueSink(env) {}

public:
  void assign(const char* data, size_t size) override {
    status_ = napi_create_string_utf8(env_, data, size, &result);
  }
};

struct NapiBufferValueSink : public NapiValueSink {
  NapiBufferValueSink (napi_env env)
    : NapiValueSink(env) {}

public:
  void assign(const char* data, size_t size) override {
    status_ = napi_create_buffer_copy(env_, size, data, NULL, &result);
  }
};

/**
 * Get a value from a database synchronously.
 */
 NAPI_METHOD(db_get_sync) {
  NAPI_ARGV(4);
  NAPI_DB_CONTEXT();

  uint32_t flags;
  NAPI_STATUS_THROWS(napi_get_value_uint32(env, argv[1], &flags));

  std::optional<leveldb::Slice> keySlice;

  if ((flags & Flags::SHARED_KEY) != 0) {
    uint32_t keySize;
    NAPI_STATUS_THROWS(napi_get_value_uint32(env, argv[2], &keySize));
    keySlice.emplace(database->sharedBuffer_, keySize);
  } else {
    char* keyBuffer;
    size_t keySize;
    NAPI_STATUS_THROWS(napi_get_typedarray_info(env, argv[2], NULL, &keySize, (void**)&keyBuffer, NULL, NULL));
    keySlice.emplace(keyBuffer, keySize);
  }

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[3], (void**)&snapshot);

  leveldb::ReadOptions options;
  options.fill_cache = (flags & Flags::FILL_CACHE) != 0;
  options.snapshot = snapshot != NULL ? snapshot->nut : NULL;

  if ((flags & Flags::VALUE_AS_BUFFER) != 0) {
    NapiBufferValueSink valueSink(env);
    leveldb::Status status = database->Get(options, *keySlice, valueSink);
    return status.ok() && valueSink.valid() ? valueSink.result : ErrorOrNotFound(env, status);
  } else {
    NapiStringValueSink valueSink(env);
    leveldb::Status status = database->Get(options, *keySlice, valueSink);
    return status.ok() && valueSink.valid() ? valueSink.result : ErrorOrNotFound(env, status);
  }
}

NAPI_METHOD(db_set_shared_buffer) {
  NAPI_ARGV(2);
  NAPI_DB_CONTEXT();

  if (!database->SetSharedBuffer(env, argv[1])) {
    napi_throw_error(env, NULL, "SetSharedBuffer failed");
    return undefined;
  }

  return undefined;
}

/**
 * Worker class for db.has().
 */
struct HasWorker final : public PriorityWorker {
  HasWorker(
    napi_env env,
    Database* database,
    napi_deferred deferred,
    leveldb::Slice key,
    const bool fillCache,
    ExplicitSnapshot* snapshot
  ) : PriorityWorker(env, database, deferred, "classic_level.db.has"),
      key_(key) {
    iterator_ = new BaseIterator(
      database,
      // Range options (not relevant)
      false, NULL, NULL, NULL, NULL, -1,
      fillCache,
      snapshot
    );
  }

  ~HasWorker () {
    DisposeSliceBuffer(key_);
    delete iterator_;
  }

  void DoExecute () override {
    // LevelDB has no Has() method so use an iterator
    result_ = iterator_->SeekExact(key_);
    SetStatus(iterator_->Status());
    iterator_->CloseIterator();
  }

  void HandleOKCallback (napi_env env, napi_deferred deferred) override {
    napi_value resultBoolean;
    napi_get_boolean(env, result_, &resultBoolean);
    napi_resolve_deferred(env, deferred, resultBoolean);
  }

private:
  leveldb::Slice key_;
  BaseIterator* iterator_;
  bool result_;
};

/**
 * Check if the database has an entry with the given key.
 */
NAPI_METHOD(db_has) {
  NAPI_ARGV(4);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  leveldb::Slice key = ToSlice(env, argv[1]);
  const bool fillCache = BooleanValue(env, argv[2], true);

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[3], (void**)&snapshot);

  HasWorker* worker = new HasWorker(
    env, database, deferred, key, fillCache, snapshot
  );

  worker->Queue(env);
  return promise;
}

/**
 * Worker class for getting many values.
 */
struct GetManyWorker final : public PriorityWorker {
  GetManyWorker (napi_env env,
                 Database* database,
                 std::vector<std::string> keys,
                 napi_deferred deferred,
                 const Encoding valueEncoding,
                 const bool fillCache,
                 ExplicitSnapshot* snapshot)
    : PriorityWorker(env, database, deferred, "classic_level.get.many"),
      keys_(std::move(keys)), valueEncoding_(valueEncoding) {
      options_.fill_cache = fillCache;

      if (snapshot == NULL) {
        implicitSnapshot_ = database->NewSnapshot();
        options_.snapshot = implicitSnapshot_;
      } else {
        implicitSnapshot_ = NULL;
        options_.snapshot = snapshot->nut;
      }
    }

  void DoExecute () override {
    cache_.reserve(keys_.size());

    for (const std::string& key: keys_) {
      std::string* value = new std::string();
      leveldb::StringValueSink wrapped(value);
      leveldb::Status status = database_->Get(options_, key, wrapped);

      if (status.ok()) {
        cache_.push_back(value);
      } else if (status.IsNotFound()) {
        delete value;
        cache_.push_back(NULL);
      } else {
        delete value;
        for (const std::string* value: cache_) {
          if (value != NULL) delete value;
        }
        SetStatus(status);
        break;
      }
    }

    if (implicitSnapshot_) {
      database_->ReleaseSnapshot(implicitSnapshot_);
    }
  }

  void HandleOKCallback (napi_env env, napi_deferred deferred) override {
    size_t size = cache_.size();
    napi_value array;
    napi_create_array_with_length(env, size, &array);

    for (size_t idx = 0; idx < size; idx++) {
      std::string* value = cache_[idx];
      napi_value element;
      Entry::Convert(env, value, valueEncoding_, element);
      napi_set_element(env, array, static_cast<uint32_t>(idx), element);
      if (value != NULL) delete value;
    }

    napi_resolve_deferred(env, deferred, array);
  }

private:
  leveldb::ReadOptions options_;
  const std::vector<std::string> keys_;
  const Encoding valueEncoding_;
  std::vector<std::string*> cache_;
  const leveldb::Snapshot* implicitSnapshot_;
};

/**
 * Gets many values from a database.
 */
NAPI_METHOD(db_get_many) {
  NAPI_ARGV(4);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  const auto keys = KeyArray(env, argv[1]);
  napi_value options = argv[2];
  const Encoding valueEncoding = GetEncoding(env, options, "valueEncoding");
  const bool fillCache = BooleanProperty(env, options, "fillCache", true);

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[3], (void**)&snapshot);

  GetManyWorker* worker = new GetManyWorker(
    env,
    database,
    keys,
    deferred,
    valueEncoding,
    fillCache,
    snapshot
  );

  worker->Queue(env);
  return promise;
}

/**
 * Worker class for db.hasMany().
 */
struct HasManyWorker final : public PriorityWorker {
  HasManyWorker(
    napi_env env,
    Database* database,
    std::vector<std::string> keys,
    napi_deferred deferred,
    uint32_t* bitset,
    const bool fillCache,
    ExplicitSnapshot* snapshot
  ) : PriorityWorker(env, database, deferred, "classic_level.has.many"),
      keys_(std::move(keys)),
      bitset_(bitset) {
    iterator_ = new BaseIterator(
      database,
      // Range options (not relevant)
      false, NULL, NULL, NULL, NULL, -1,
      fillCache,
      snapshot
    );
  }

  ~HasManyWorker () {
    delete iterator_;
  }

  void DoExecute () override {
    for (size_t i = 0; i != keys_.size(); i++) {
      leveldb::Slice target = leveldb::Slice(keys_[i]);

      if (iterator_->SeekExact(target)) {
        bitset_[i >> 5] |= 1 << (i & 31); // Set bit
      }
    }

    SetStatus(iterator_->Status());
    iterator_->CloseIterator();
  }

private:
  const std::vector<std::string> keys_;
  uint32_t* bitset_;
  BaseIterator* iterator_;
};

/**
 * Check if the database has entries with the given keys.
 */
NAPI_METHOD(db_has_many) {
  NAPI_ARGV(5);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  const auto keys = KeyArray(env, argv[1]);
  const bool fillCache = BooleanValue(env, argv[2], true);

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[3], (void**)&snapshot);

  uint32_t* bitset = NULL;
  NAPI_STATUS_THROWS(napi_get_arraybuffer_info(env, argv[4], (void**)&bitset, NULL));

  HasManyWorker* worker = new HasManyWorker(
    env, database, keys, deferred, bitset, fillCache, snapshot
  );

  worker->Queue(env);
  return promise;
}

/**
 * Worker class for deleting a value from a database.
 */
struct DelWorker final : public PriorityWorker {
  DelWorker (napi_env env,
             Database* database,
             napi_deferred deferred,
             leveldb::Slice key,
             bool sync)
    : PriorityWorker(env, database, deferred, "classic_level.db.del"),
      key_(key) {
    options_.sync = sync;
  }

  ~DelWorker () {
    DisposeSliceBuffer(key_);
  }

  void DoExecute () override {
    SetStatus(database_->Del(options_, key_));
  }

  leveldb::WriteOptions options_;
  leveldb::Slice key_;
};

/**
 * Delete a value from a database.
 */
NAPI_METHOD(db_del) {
  NAPI_ARGV(3);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  leveldb::Slice key = ToSlice(env, argv[1]);
  bool sync = BooleanProperty(env, argv[2], "sync", false);

  DelWorker* worker = new DelWorker(env, database, deferred, key, sync);
  worker->Queue(env);

  return promise;
}

/**
 * Worker class for deleting a range from a database.
 */
struct ClearWorker final : public PriorityWorker {
  ClearWorker (napi_env env,
               Database* database,
               napi_deferred deferred,
               const bool reverse,
               const int limit,
               std::string* lt,
               std::string* lte,
               std::string* gt,
               std::string* gte,
               ExplicitSnapshot* snapshot)
    : PriorityWorker(env, database, deferred, "classic_level.db.clear") {
    iterator_ = new BaseIterator(database, reverse, lt, lte, gt, gte, limit, false, snapshot);
    writeOptions_ = new leveldb::WriteOptions();
    writeOptions_->sync = false;
  }

  ~ClearWorker () {
    delete iterator_;
    delete writeOptions_;
  }

  void DoExecute () override {
    iterator_->SeekToRange();

    // TODO: add option
    uint32_t hwm = 16 * 1024;
    leveldb::WriteBatch batch;

    while (true) {
      size_t bytesRead = 0;

      while (bytesRead <= hwm && iterator_->Valid() && iterator_->Increment()) {
        leveldb::Slice key = iterator_->CurrentKey();
        batch.Delete(key);
        bytesRead += key.size();
        iterator_->Next();
      }

      if (!SetStatus(iterator_->Status()) || bytesRead == 0) {
        break;
      }

      if (!SetStatus(database_->WriteBatch(*writeOptions_, &batch))) {
        break;
      }

      batch.Clear();
    }

    iterator_->CloseIterator();
  }

private:
  BaseIterator* iterator_;
  leveldb::WriteOptions* writeOptions_;
};

/**
 * Delete a range from a database.
 */
NAPI_METHOD(db_clear) {
  NAPI_ARGV(3);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  napi_value options = argv[1];

  const bool reverse = BooleanProperty(env, options, "reverse", false);
  const int limit = Int32Property(env, options, "limit", -1);

  std::string* lt = RangeOption(env, options, "lt");
  std::string* lte = RangeOption(env, options, "lte");
  std::string* gt = RangeOption(env, options, "gt");
  std::string* gte = RangeOption(env, options, "gte");

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[2], (void**)&snapshot);

  ClearWorker* worker = new ClearWorker(
    env, database, deferred, reverse, limit, lt, lte, gt, gte, snapshot
  );

  worker->Queue(env);
  return promise;
}

/**
 * Worker class for calculating the size of a range.
 */
struct ApproximateSizeWorker final : public PriorityWorker {
  ApproximateSizeWorker (napi_env env,
                         Database* database,
                         napi_deferred deferred,
                         leveldb::Slice start,
                         leveldb::Slice end)
    : PriorityWorker(env, database, deferred, "classic_level.db.approximate_size"),
      start_(start), end_(end) {}

  ~ApproximateSizeWorker () {
    DisposeSliceBuffer(start_);
    DisposeSliceBuffer(end_);
  }

  void DoExecute () override {
    leveldb::Range range(start_, end_);
    size_ = database_->ApproximateSize(&range);
  }

  void HandleOKCallback (napi_env env, napi_deferred deferred) override {
    napi_value argv;
    napi_create_int64(env, (uint64_t)size_, &argv);
    napi_resolve_deferred(env, deferred, argv);
  }

  leveldb::Slice start_;
  leveldb::Slice end_;
  uint64_t size_;
};

/**
 * Calculates the approximate size of a range in a database.
 */
NAPI_METHOD(db_approximate_size) {
  NAPI_ARGV(3);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  leveldb::Slice start = ToSlice(env, argv[1]);
  leveldb::Slice end = ToSlice(env, argv[2]);

  ApproximateSizeWorker* worker = new ApproximateSizeWorker(
    env, database, deferred, start, end
  );

  worker->Queue(env);
  return promise;
}

/**
 * Worker class for compacting a range in a database.
 */
struct CompactRangeWorker final : public PriorityWorker {
  CompactRangeWorker (napi_env env,
                      Database* database,
                      napi_deferred deferred,
                      leveldb::Slice start,
                      leveldb::Slice end)
    : PriorityWorker(env, database, deferred, "classic_level.db.compact_range"),
      start_(start), end_(end) {}

  ~CompactRangeWorker () {
    DisposeSliceBuffer(start_);
    DisposeSliceBuffer(end_);
  }

  void DoExecute () override {
    database_->CompactRange(&start_, &end_);
  }

  leveldb::Slice start_;
  leveldb::Slice end_;
};

/**
 * Compacts a range in a database.
 */
NAPI_METHOD(db_compact_range) {
  NAPI_ARGV(3);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  leveldb::Slice start = ToSlice(env, argv[1]);
  leveldb::Slice end = ToSlice(env, argv[2]);

  CompactRangeWorker* worker = new CompactRangeWorker(
    env, database, deferred, start, end
  );

  worker->Queue(env);
  return promise;
}

/**
 * Get a property from a database.
 */
NAPI_METHOD(db_get_property) {
  NAPI_ARGV(2);
  NAPI_DB_CONTEXT();

  leveldb::Slice property = ToSlice(env, argv[1]);

  std::string value;
  database->GetProperty(property, &value);

  napi_value result;
  napi_create_string_utf8(env, value.data(), value.size(), &result);

  DisposeSliceBuffer(property);

  return result;
}

/**
 * Worker class for destroying a database.
 */
struct DestroyWorker final : public BaseWorker {
  DestroyWorker (napi_env env, const std::string& location, napi_deferred deferred)
    : BaseWorker(env, NULL, deferred, "classic_level.destroy_db"),
      location_(location) {}

  ~DestroyWorker () {}

  void DoExecute () override {
    leveldb::Options options;
    SetStatus(leveldb::DestroyDB(location_, options));
  }

  std::string location_;
};

/**
 * Destroys a database.
 */
NAPI_METHOD(destroy_db) {
  NAPI_ARGV(1);
  NAPI_ARGV_UTF8_NEW(location, 0);
  NAPI_PROMISE();

  DestroyWorker* worker = new DestroyWorker(env, location, deferred);
  worker->Queue(env);

  delete [] location;
  return promise;
}

/**
 * Worker class for repairing a database.
 */
struct RepairWorker final : public BaseWorker {
  RepairWorker (napi_env env, const std::string& location, napi_deferred deferred)
    : BaseWorker(env, NULL, deferred, "classic_level.repair_db"),
      location_(location) {}

  ~RepairWorker () {}

  void DoExecute () override {
    leveldb::Options options;
    SetStatus(leveldb::RepairDB(location_, options));
  }

  std::string location_;
};

/**
 * Repairs a database.
 */
NAPI_METHOD(repair_db) {
  NAPI_ARGV(1);
  NAPI_ARGV_UTF8_NEW(location, 0);
  NAPI_PROMISE();

  RepairWorker* worker = new RepairWorker(env, location, deferred);
  worker->Queue(env);

  delete [] location;

  return promise;
}

/**
 * Create an iterator.
 */
NAPI_METHOD(iterator_init) {
  NAPI_ARGV(4);
  NAPI_DB_CONTEXT();

  unsigned char* state = 0;
  size_t stateLength;
  NAPI_STATUS_THROWS(napi_get_typedarray_info(env, argv[1], NULL, &stateLength, (void**)&state, NULL, NULL));
  assert(stateLength == 1);

  napi_value options = argv[2];
  const bool reverse = BooleanProperty(env, options, "reverse", false);
  const bool keys = BooleanProperty(env, options, "keys", true);
  const bool values = BooleanProperty(env, options, "values", true);
  const bool fillCache = BooleanProperty(env, options, "fillCache", false);
  const Encoding keyEncoding = GetEncoding(env, options, "keyEncoding");
  const Encoding valueEncoding = GetEncoding(env, options, "valueEncoding");
  const int limit = Int32Property(env, options, "limit", -1);
  const uint32_t highWaterMarkBytes = Uint32Property(env, options, "highWaterMarkBytes", 16 * 1024);

  std::string* lt = RangeOption(env, options, "lt");
  std::string* lte = RangeOption(env, options, "lte");
  std::string* gt = RangeOption(env, options, "gt");
  std::string* gte = RangeOption(env, options, "gte");

  ExplicitSnapshot* snapshot = NULL;
  napi_get_value_external(env, argv[3], (void**)&snapshot);

  Iterator* iterator = new Iterator(
    database,
    reverse,
    keys, values,
    limit,
    lt, lte, gt, gte,
    fillCache,
    keyEncoding, valueEncoding,
    highWaterMarkBytes,
    state,
    snapshot
  );

  napi_value result;
  NAPI_STATUS_THROWS(napi_create_external(env, iterator,
                                          Resource::CollectGarbage,
                                          NULL, &result));

  iterator->Attach(env, result);

  return result;
}

/**
 * Seeks an iterator.
 */
NAPI_METHOD(iterator_seek) {
  NAPI_ARGV(2);
  NAPI_ITERATOR_CONTEXT();

  // AbstractIterator should not call _seek() after _close()
  assert(!iterator->hasClosed_);

  leveldb::Slice target = ToSlice(env, argv[1]);
  iterator->first_ = true;
  iterator->ended_ = false;
  iterator->Seek(target);

  DisposeSliceBuffer(target);
  NAPI_RETURN_UNDEFINED();
}

/**
 * Closes an iterator.
 */
NAPI_METHOD(iterator_close) {
  NAPI_ARGV(1);
  NAPI_ITERATOR_CONTEXT();

  // AbstractIterator should not call _close() more than once or while nexting
  assert(!iterator->hasClosed_);
  assert(!iterator->nexting_);

  iterator->CloseResource();
  iterator->Detach(env);

  NAPI_RETURN_UNDEFINED();
}

/**
 * Aborts a NextWorker (if any, eventually).
 */
NAPI_METHOD(iterator_abort) {
  NAPI_ARGV(1);
  NAPI_ITERATOR_CONTEXT();
  iterator->aborted_ = true;
  NAPI_RETURN_UNDEFINED();
}

/**
 * Worker class for nexting an iterator.
 */
struct NextWorker final : public BaseWorker {
  NextWorker (napi_env env, Iterator* iterator, uint32_t size, napi_deferred deferred)
    : BaseWorker(env, iterator->database, deferred, "classic_level.iterator.next"),
      iterator_(iterator), size_(size), ok_() {}

  ~NextWorker () {}

  void DoExecute () override {
    if (!iterator_->DidSeek()) {
      iterator_->SeekToRange();
    }

    ok_ = iterator_->ReadMany(size_);

    if (!ok_) {
      SetStatus(iterator_->Status());
    }
  }

  void HandleOKCallback (napi_env env, napi_deferred deferred) override {
    if (iterator_->aborted_) {
      napi_value err = CreateCodeError(env, "LEVEL_ABORTED", "Operation has been aborted");
      napi_value name;
      napi_create_string_utf8(env, "AbortError", NAPI_AUTO_LENGTH, &name);
      napi_set_named_property(env, err, "name", name);
      napi_reject_deferred(env, deferred, err);
      return;
    }

    size_t size = iterator_->cache_.size();
    napi_value jsArray;
    napi_create_array_with_length(env, size, &jsArray);

    const Encoding ke = iterator_->keyEncoding_;
    const Encoding ve = iterator_->valueEncoding_;

    for (uint32_t idx = 0; idx < size; idx++) {
      napi_value element;
      iterator_->cache_[idx].ConvertByMode(env, Mode::entries, ke, ve, element);
      napi_set_element(env, jsArray, idx, element);
    }

    // TODO: use state_ internally too, replacing ended_?
    if (iterator_->ended_) {
      *iterator_->state_ |= STATE_ENDED;
    }

    napi_resolve_deferred(env, deferred, jsArray);
  }

  void DoFinally (napi_env env) override {
    iterator_->nexting_ = false;
    BaseWorker::DoFinally(env);
  }

private:
  Iterator* iterator_;
  uint32_t size_;
  bool ok_;
};

/**
 * Advance repeatedly and get multiple entries at once.
 */
NAPI_METHOD(iterator_nextv) {
  NAPI_ARGV(2);
  NAPI_ITERATOR_CONTEXT();
  NAPI_PROMISE();

  uint32_t size;
  NAPI_STATUS_THROWS(napi_get_value_uint32(env, argv[1], &size));
  if (size == 0) size = 1;

  // AbstractIterator should not call _next() or _nextv() after _close()
  assert(!iterator->hasClosed_);

  if (iterator->ended_) {
    napi_value empty;
    napi_create_array_with_length(env, 0, &empty);
    napi_resolve_deferred(env, deferred, empty);
  } else {
    NextWorker* worker = new NextWorker(env, iterator, size, deferred);
    iterator->nexting_ = true;
    worker->Queue(env);
  }

  return promise;
}

/**
 * Worker class for batch write operation.
 */
struct BatchWorker final : public PriorityWorker {
  BatchWorker (napi_env env,
               Database* database,
               napi_deferred deferred,
               leveldb::WriteBatch* batch,
               const bool sync,
               const bool hasData)
    : PriorityWorker(env, database, deferred, "classic_level.batch.do"),
      batch_(batch), hasData_(hasData) {
    options_.sync = sync;
  }

  ~BatchWorker () {
    delete batch_;
  }

  void DoExecute () override {
    if (hasData_) {
      SetStatus(database_->WriteBatch(options_, batch_));
    }
  }

private:
  leveldb::WriteOptions options_;
  leveldb::WriteBatch* batch_;
  const bool hasData_;
};

/**
 * Does a batch write operation on a database.
 */
NAPI_METHOD(batch_do) {
  NAPI_ARGV(3);
  NAPI_DB_CONTEXT();
  NAPI_PROMISE();

  napi_value array = argv[1];
  const bool sync = BooleanProperty(env, argv[2], "sync", false);

  uint32_t length;
  napi_get_array_length(env, array, &length);

  leveldb::WriteBatch* batch = new leveldb::WriteBatch();
  bool hasData = false;

  for (uint32_t i = 0; i < length; i++) {
    napi_value element;
    napi_get_element(env, array, i, &element);

    if (!IsObject(env, element)) continue;

    std::string type = StringProperty(env, element, "type");

    if (type == "del") {
      if (!HasProperty(env, element, "key")) continue;
      leveldb::Slice key = ToSlice(env, GetProperty(env, element, "key"));

      batch->Delete(key);
      if (!hasData) hasData = true;

      DisposeSliceBuffer(key);
    } else if (type == "put") {
      if (!HasProperty(env, element, "key")) continue;
      if (!HasProperty(env, element, "value")) continue;

      leveldb::Slice key = ToSlice(env, GetProperty(env, element, "key"));
      leveldb::Slice value = ToSlice(env, GetProperty(env, element, "value"));

      batch->Put(key, value);
      if (!hasData) hasData = true;

      DisposeSliceBuffer(key);
      DisposeSliceBuffer(value);
    }
  }

  BatchWorker* worker = new BatchWorker(
    env, database, deferred, batch, sync, hasData
  );

  worker->Queue(env);
  return promise;
}

/**
 * Owns a WriteBatch.
 */
struct Batch {
  Batch (Database* database)
    : database_(database),
      batch_(new leveldb::WriteBatch()),
      hasData_(false) {}

  ~Batch () {
    delete batch_;
  }

  void Put (leveldb::Slice key, leveldb::Slice value) {
    batch_->Put(key, value);
    hasData_ = true;
  }

  void Del (leveldb::Slice key) {
    batch_->Delete(key);
    hasData_ = true;
  }

  void Clear () {
    batch_->Clear();
    hasData_ = false;
  }

  leveldb::Status Write (bool sync) {
    leveldb::WriteOptions options;
    options.sync = sync;
    return database_->WriteBatch(options, batch_);
  }

  Database* database_;
  leveldb::WriteBatch* batch_;
  bool hasData_;
};

/**
 * Runs when a Batch is garbage collected.
 */
static void FinalizeBatch (napi_env env, void* data, void* hint) {
  if (data) {
    delete (Batch*)data;
  }
}

/**
 * Return a batch object.
 */
NAPI_METHOD(batch_init) {
  NAPI_ARGV(1);
  NAPI_DB_CONTEXT();

  Batch* batch = new Batch(database);

  napi_value result;
  NAPI_STATUS_THROWS(napi_create_external(env, batch,
                                          FinalizeBatch,
                                          NULL, &result));
  return result;
}

/**
 * Adds a put instruction to a batch object.
 */
NAPI_METHOD(batch_put) {
  NAPI_ARGV(3);
  NAPI_BATCH_CONTEXT();

  leveldb::Slice key = ToSlice(env, argv[1]);
  leveldb::Slice value = ToSlice(env, argv[2]);
  batch->Put(key, value);
  DisposeSliceBuffer(key);
  DisposeSliceBuffer(value);

  NAPI_RETURN_UNDEFINED();
}

/**
 * Adds a delete instruction to a batch object.
 */
NAPI_METHOD(batch_del) {
  NAPI_ARGV(2);
  NAPI_BATCH_CONTEXT();

  leveldb::Slice key = ToSlice(env, argv[1]);
  batch->Del(key);
  DisposeSliceBuffer(key);

  NAPI_RETURN_UNDEFINED();
}

/**
 * Clears a batch object.
 */
NAPI_METHOD(batch_clear) {
  NAPI_ARGV(1);
  NAPI_BATCH_CONTEXT();

  batch->Clear();

  NAPI_RETURN_UNDEFINED();
}

/**
 * Worker class for batch write operation.
 */
struct BatchWriteWorker final : public PriorityWorker {
  BatchWriteWorker (napi_env env,
                    napi_value context,
                    Batch* batch,
                    napi_deferred deferred,
                    const bool sync)
    : PriorityWorker(env, batch->database_, deferred, "classic_level.batch.write"),
      batch_(batch),
      sync_(sync) {
        // Prevent GC of batch object before we execute
        NAPI_STATUS_THROWS_VOID(napi_create_reference(env, context, 1, &contextRef_));
      }

  ~BatchWriteWorker () {}

  void DoExecute () override {
    if (batch_->hasData_) {
      SetStatus(batch_->Write(sync_));
    }
  }

  void DoFinally (napi_env env) override {
    napi_delete_reference(env, contextRef_);
    PriorityWorker::DoFinally(env);
  }

private:
  Batch* batch_;
  const bool sync_;
  napi_ref contextRef_;
};

/**
 * Writes a batch object.
 */
NAPI_METHOD(batch_write) {
  NAPI_ARGV(2);
  NAPI_BATCH_CONTEXT();
  NAPI_PROMISE();

  napi_value options = argv[1];
  const bool sync = BooleanProperty(env, options, "sync", false);

  BatchWriteWorker* worker = new BatchWriteWorker(
    env, argv[0], batch, deferred, sync
  );

  worker->Queue(env);
  return promise;
}

/**
 * Create a snapshot context.
 */
NAPI_METHOD(snapshot_init) {
  NAPI_ARGV(1);
  NAPI_DB_CONTEXT();

  ExplicitSnapshot* snapshot = new ExplicitSnapshot(database);

  napi_value context;
  NAPI_STATUS_THROWS(napi_create_external(
    env,
    snapshot,
    Resource::CollectGarbage,
    NULL,
    &context
  ));

  snapshot->Attach(env, context);
  return context;
}

/**
 * Closes the snapshot.
 */
NAPI_METHOD(snapshot_close) {
  NAPI_ARGV(1);
  NAPI_SNAPSHOT_CONTEXT();

  snapshot->CloseResource();
  snapshot->Detach(env);

  NAPI_RETURN_UNDEFINED();
}

/**
 * All exported functions.
 */
NAPI_INIT() {
  NAPI_EXPORT_FUNCTION(db_init);
  NAPI_EXPORT_FUNCTION(db_set_shared_buffer)
  NAPI_EXPORT_FUNCTION(db_open);
  NAPI_EXPORT_FUNCTION(db_close);
  NAPI_EXPORT_FUNCTION(db_put);
  NAPI_EXPORT_FUNCTION(db_get);
  NAPI_EXPORT_FUNCTION(db_get_sync);
  NAPI_EXPORT_FUNCTION(db_get_many);
  NAPI_EXPORT_FUNCTION(db_has);
  NAPI_EXPORT_FUNCTION(db_has_many);
  NAPI_EXPORT_FUNCTION(db_del);
  NAPI_EXPORT_FUNCTION(db_clear);
  NAPI_EXPORT_FUNCTION(db_approximate_size);
  NAPI_EXPORT_FUNCTION(db_compact_range);
  NAPI_EXPORT_FUNCTION(db_get_property);

  NAPI_EXPORT_FUNCTION(destroy_db);
  NAPI_EXPORT_FUNCTION(repair_db);

  NAPI_EXPORT_FUNCTION(iterator_init);
  NAPI_EXPORT_FUNCTION(iterator_seek);
  NAPI_EXPORT_FUNCTION(iterator_close);
  NAPI_EXPORT_FUNCTION(iterator_nextv);
  NAPI_EXPORT_FUNCTION(iterator_abort);

  NAPI_EXPORT_FUNCTION(batch_do);
  NAPI_EXPORT_FUNCTION(batch_init);
  NAPI_EXPORT_FUNCTION(batch_put);
  NAPI_EXPORT_FUNCTION(batch_del);
  NAPI_EXPORT_FUNCTION(batch_clear);
  NAPI_EXPORT_FUNCTION(batch_write);

  NAPI_EXPORT_FUNCTION(snapshot_init);
  NAPI_EXPORT_FUNCTION(snapshot_close);
}
