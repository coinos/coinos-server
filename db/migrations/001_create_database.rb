class CreateDatabase <  ActiveRecord::Migration
  def change 
    create_table :users do |t|
      t.string :login
      t.string :password
      t.string :name
      t.string :address
      t.decimal :credit, :precision => 10, :scale => 2
      t.string :logo
    end

    create_table :transactions do |t|
      t.string :address
      t.decimal :amount, :precision => 10, :scale => 2
      t.decimal :exchange, :precision => 10, :scale => 2
      t.timestamps
    end
  end
end
