#ifndef STORAGE_LEVELDB_INCLUDE_VALUE_SINK_H_
#define STORAGE_LEVELDB_INCLUDE_VALUE_SINK_H_

namespace leveldb {
  struct ValueSink {
    public:
      ValueSink () {}

      // Same as std::string:assign
      virtual void assign(const char* s, size_t n) = 0;
  };

  struct StringValueSink : public ValueSink {
    public:
      StringValueSink (std::string* nut)
        : ValueSink(), nut_(nut) {}

      void assign(const char* s, size_t n) override {
        nut_->assign(s, n);
      }
    private:
      std::string* nut_;
  };
}

#endif // STORAGE_LEVELDB_INCLUDE_VALUE_SINK_H_
