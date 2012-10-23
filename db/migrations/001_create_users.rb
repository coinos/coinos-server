class CreateUsers <  ActiveRecord::Migration
  def change 
    create_table :users do |t|
      t.string :name
      t.string :address
      t.decimal :credit, :precision => 10, :scale => 2
      t.string :logo
    end
  end
end
